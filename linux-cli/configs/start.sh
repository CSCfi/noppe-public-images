#!/bin/bash
set -eo pipefail

# USERNAME is fixed when the image is built, not here. Noppe seeds the session
# volume by running `cp -aT /home/$USERNAME /data` against this image, and
# SESSION_DIR_CHOWN_UID names the same account, so both follow the built-in name.
: "${USERNAME:=user}"
if ! id "$USERNAME" &>/dev/null; then
    echo "start: no account '$USERNAME' in this image." >&2
    echo "start: rebuild with --build-arg USERNAME=$USERNAME to change it." >&2
    exit 1
fi

# With no PASSWORD, generate one for this session rather than falling back to a
# fixed default, which would be a published credential. The course content
# templates {{PASSWORD}} into the page, so a generated one stays discoverable.
if [ -z "${PASSWORD:-}" ]; then
    # Bounded read then cut; the usual `/dev/urandom | head -c` takes a SIGPIPE
    # that pipefail turns into a failed startup. Alphabet omits i l o 0 1.
    PASSWORD=$(head -c 512 /dev/urandom | LC_ALL=C tr -dc 'a-hj-km-np-z2-9' | cut -c1-10)
    echo "start: PASSWORD not set, generated '$PASSWORD' for this session" >&2
fi
echo "$USERNAME:$PASSWORD" | chpasswd

# Start ttyd and wait until it is accepting connections. Loopback only: Caddy
# reverse-proxies to localhost:7681 and nothing else should reach the shell.
ttyd -W -i lo -p 7681 login &
until (echo >/dev/tcp/localhost/7681) 2>/dev/null; do sleep 0.1; done

# Set the hostname for the slurm configuration
HOSTNAME=$(hostname)

# Inject the actual hostname in slurm.conf and propagate to the other locations
sed -i "s|__HOSTNAME__|$HOSTNAME|g" /etc/slurm/slurm.conf
cp /etc/slurm/slurm.conf /etc/slurm-llnl/slurm.conf
cp /etc/slurm/slurm.conf /usr/local/etc/slurm.conf

# Noppe clones the content repository into the home under the repository's own
# name; set CONTENT_DIR to that name when it is not noppe-cli. A plain name with
# no slash and no leading dot cannot point outside the home, which matters
# because the substitution below runs sed -i as root over whatever it names.
CONTENT_DIR="${CONTENT_DIR:-noppe-cli}"
case "$CONTENT_DIR" in
    .* | *[!A-Za-z0-9._-]*)
        echo "start: CONTENT_DIR must be a plain directory name, ignoring '$CONTENT_DIR'" >&2
        CONTENT_DIR=""
        ;;
    *)
        CONTENT_DIR="/home/${USERNAME}/${CONTENT_DIR}"
        ;;
esac

# Without a manifest there is nothing to serve, and the placeholder content baked
# into the image is the more useful thing to keep.
if [ -n "$CONTENT_DIR" ] && [ -f "${CONTENT_DIR}/manifest.json" ]; then
    echo "start: serving course content from $CONTENT_DIR" >&2
    # Inject the actual hostname, password and username in all md files.
    # sed's replacement treats \ and & specially and | is the delimiter here, so
    # escape them: an unescaped | ends the expression and aborts startup, and an
    # unescaped & expands to the whole match.
    sed_escape() { printf '%s' "$1" | sed -e 's/[\\&|]/\\&/g'; }
    E_HOSTNAME=$(sed_escape "$HOSTNAME")
    E_USERNAME=$(sed_escape "$USERNAME")
    E_PASSWORD=$(sed_escape "$PASSWORD")
    USER_UID=$(id -u ${USERNAME})
    USER_GID=$(id -g ${USERNAME})
    # -r: a repo can carry a manifest but no top-level *.md, and xargs would
    # otherwise run sed with no operands and abort the script.
    find "${CONTENT_DIR}/" -type f -name "*.md" -print0 | xargs -0 -r sed -i \
        -e "s|{{HOSTNAME}}|${E_HOSTNAME}|g" \
        -e "s|{{USERNAME}}|${E_USERNAME}|g" \
        -e "s|{{PASSWORD}}|${E_PASSWORD}|g" \
        -e "s|{{UID}}|${USER_UID}|g" \
        -e "s|{{GID}}|${USER_GID}|g"

    rm -fr /app/content
    ln -s "${CONTENT_DIR}" /app/content
else
    echo "start: no manifest.json under ${CONTENT_DIR:-<none>}, serving the placeholder" >&2
fi

# Start munge and wait until it is ready before starting slurm
service munge start
until service munge status >/dev/null 2>&1; do sleep 0.2; done
slurmd
slurmctld

# Caddy runs as the session user, who can then read its environment: reset it.
# XDG_DATA_HOME (Caddy appends caddy/) keeps its state out of the home volume.
exec setpriv --reuid="$USERNAME" --regid="$USERNAME" --init-groups \
    --bounding-set=-all --inh-caps=-all --reset-env \
    env XDG_DATA_HOME=/var/lib caddy run --config /etc/caddy/Caddyfile
