#!/bin/bash
set -e

# Version configuration
SLURM_VER="24.05.8"
PMIX_VER="4.2.9"
OPENMPI_VER="4.1.4"

# sha256 of the source tarballs below. Bump these with the versions above.
PMIX_SHA256="00ddb36fb81c31519972079a218c3cdd903510fc3910abaf4d484068fa29e884"
SLURM_SHA256="59c33ee924bdf105fe288b65798d6db0fca12244aec8bcb4b346a89ccddd39d0"
OPENMPI_SHA256="e166dbe876e13a50c2882e11193fecbc4362e89e6e7b6deeb69bf095c0f4fc4c"

# Download to $2 and verify. Without --fail curl writes an HTTP error body into
# the file and exits 0, so the build would fail later at tar with a misleading
# message.
fetch() {
    curl -fsSL -o "$2" "$1"
    echo "$3  $2" | sha256sum -c -
}

# nproc honours the cpuset but not a CPU quota, so cap the job count.
MAKE_JOBS="${MAKE_JOBS:-$(nproc)}"
MAKE_JOBS=$(( MAKE_JOBS > 8 ? 8 : MAKE_JOBS ))

# Use USERNAME from Docker build arg (ENV), fall back to "user"
USERNAME="${USERNAME:-user}"

# Install script for the contents of the OS used in
# the learning environment

# Remove Ubuntu minimal's dpkg excludes so man pages are actually installed
# with packages. Must happen before any apt-get install.
rm -f /etc/dpkg/dpkg.cfg.d/excludes

# Configure commands available
apt-get update && \
apt-get upgrade -y && \
apt-get install -y \
    tini \
    ttyd \
    nano \
    vim \
    emacs-nox \
    iputils-ping \
    tmux \
    screen \
    tree \
    wget \
    curl \
    less \
    file \
    python3 \
    python3-pip \
    python3-dev \
    python3-mpi4py \
    python3-venv \
    python-is-python3 \
    rsync \
    unzip \
    git \
    munge \
    libmunge2 \
    libmunge-dev \
    make \
    perl \
    psmisc \
    build-essential \
    bash-completion \
    libboost-dev \
    libevent-dev \
    libhwloc-dev \
    zlib1g-dev \
    man-db \
    manpages \
    manpages-dev \
    manpages-posix \
    info \
    groff \
    sl \
    catimg \
    jp2a \
    bc \
    htop

# Reinstall packages pre-installed in the base image to get their man pages
# (the base image stripped them via dpkg excludes before we removed that file)
apt-get install --reinstall -y bash grep coreutils

# Temporary directory for installing slurm
mkdir /slurm
trap 'rm -rf /slurm' EXIT

# Build and install PMIx
fetch "https://github.com/openpmix/openpmix/releases/download/v${PMIX_VER}/pmix-${PMIX_VER}.tar.gz" \
    "/slurm/pmix-${PMIX_VER}.tar.gz" "$PMIX_SHA256"
tar -xf /slurm/pmix-${PMIX_VER}.tar.gz -C /slurm/
cd /slurm/pmix-${PMIX_VER}
./configure --prefix=/usr/local
make -j"$MAKE_JOBS" all
make install
install -D -m644 LICENSE /usr/share/licenses/pmix/LICENSE

# Build and install Slurm
fetch "https://download.schedmd.com/slurm/slurm-${SLURM_VER}.tar.bz2" \
    "/slurm/slurm-${SLURM_VER}.tar.bz2" "$SLURM_SHA256"
tar -xjf /slurm/slurm-${SLURM_VER}.tar.bz2 -C /slurm/
cd /slurm/slurm-${SLURM_VER}
./configure --with-pmix=/usr/local
make -j"$MAKE_JOBS"
make install
install -D -m644 COPYING /usr/share/licenses/slurm/COPYING
install -D -m644 LICENSE.OpenSSL /usr/share/licenses/slurm/LICENSE.OpenSSL
cp etc/slurmd.service /etc/systemd/system/slurmd.service
cp etc/slurmctld.service /etc/systemd/system/slurmctld.service
cp etc/init.d.slurm /etc/init.d/slurm
chmod +x /etc/init.d/slurm

# Build and install Open MPI
fetch "https://download.open-mpi.org/release/open-mpi/v${OPENMPI_VER%.*}/openmpi-${OPENMPI_VER}.tar.gz" \
    "/slurm/openmpi-${OPENMPI_VER}.tar.gz" "$OPENMPI_SHA256"
tar -xf /slurm/openmpi-${OPENMPI_VER}.tar.gz -C /slurm/
cd /slurm/openmpi-${OPENMPI_VER}
./configure --prefix=/usr/local/ --with-slurm --with-pmix=/usr/local --enable-mpi-cxx
make -j"$MAKE_JOBS" all
make install
install -D -m644 LICENSE /usr/share/licenses/openmpi/LICENSE

# Update shared library cache
ldconfig

# Create slurm user
useradd -r slurm

# Create directories and set permissions
mkdir -p /var/spool/slurmd
chown -R slurm:slurm /var/spool/slurm*

mkdir -p /var/log/slurm
chown -R slurm:slurm /var/log/slurm

mkdir -p /var/log/slurm-llnl
chown -R slurm:slurm /var/log/slurm-llnl

touch /var/log/slurm_jobacct.log
chown slurm:slurm /var/log/slurm_jobacct.log

touch /var/log/slurm-llnl/slurmctld.log
chown slurm:slurm /var/log/slurm-llnl/slurmctld.log

# Copy slurm configuration
mkdir -p /etc/slurm-llnl /etc/slurm /usr/local/etc
cp /slurm.conf /etc/slurm-llnl/slurm.conf
cp /slurm.conf /etc/slurm/slurm.conf
cp /slurm.conf /usr/local/etc/slurm.conf

# Create cgroup.conf with cgroups disabled (required for container environments)
cat > /etc/slurm-llnl/cgroup.conf << 'EOF'
CgroupPlugin=disabled
EOF
cp /etc/slurm-llnl/cgroup.conf /etc/slurm/cgroup.conf
cp /etc/slurm-llnl/cgroup.conf /usr/local/etc/cgroup.conf

# Cleanup temporary build directory
rm /slurm.conf

echo "" > /etc/legal
apt-get clean
apt-get autoremove --purge -y
# Keep /var/lib/dpkg/status: it is the only record of which package versions
# shipped, which GPL source requests need. Do not `rm -rf /var/lib/dpkg` here.
rm -rf /var/lib/apt/lists
rm -f /etc/apt/sources.list
rm -rf /etc/apt/sources.list.d
rm -rf /var/log/apt
rm -rf /var/cache/apt

# List of commands that are not wanted (use -f to avoid failure if missing)
rm -f /usr/bin/ping6
rm -f /usr/bin/unminimize

# Replace Ubuntu minimal's man stub with the real binary installed by man-db
[ -f /usr/bin/man.REAL ] && mv /usr/bin/man.REAL /usr/bin/man

# Remove write permissions from key directories
chmod -R a-w /usr/bin /usr/sbin /sbin

# Build the man page database as the 'man' user so it writes to the
# system-wide cache (/var/cache/man) rather than root's home directory
runuser -u man -- mandb

# Configure user's default settings.
# ubuntu:24.04 ships a default "ubuntu" account on uid/gid 1000. Noppe applies
# fsGroup 1000 to the my-work and shared volumes, so this account has to own that
# id; on the next free id it lands outside the group that owns them and my-work
# is not writable.
# userdel -r exits non-zero on a missing mail spool; if it genuinely fails to
# free uid 1000 the groupadd below fails loudly, so tolerate it here.
if getent passwd ubuntu >/dev/null; then
    userdel -r ubuntu || true
fi
groupadd -g 1000 "$USERNAME"
useradd -M -u 1000 -g 1000 -s /bin/bash "$USERNAME"

mkdir -p /home/"$USERNAME"

cat > /home/"$USERNAME"/.bashrc << 'BASHRC'
# Welcome! If you wish to read first, the Chapter 'Homecoming' discusses editing this file.

# Check whether this is an interactive shell or a script execution shell.
[ -z "$PS1" ] && return

# If interactive, let's set up some tools.
PS1='\u@\h:\w\$ '
alias ls='ls --color=auto'
alias ll='ls -la'
BASHRC

cat > /home/"$USERNAME"/.profile << 'PROFILE'
[ -n "$BASH_VERSION" ] && [ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"
PROFILE

# Ownership
chown -R "$USERNAME:" /home/"$USERNAME"

# Generate a minimum pam.d/login file to correctly show motd message above
cat > /etc/pam.d/login << 'EOF'
auth       required     pam_securetty.so
auth       requisite    pam_nologin.so
auth       include      common-auth
account    include      common-account
session    required     pam_env.so readenv=1
session    required     pam_env.so readenv=1 envfile=/etc/default/locale
session    required     pam_motd.so motd=/etc/motd
session    include      common-session
session    optional     pam_mail.so standard
EOF

# Generate a welcome message and a brief disclaimer
cat > /etc/motd << 'EOF'

███       ███
█████████████
█████████████
██  █████  ██
█████████████   Noppe
█████████████   Ubuntu Linux 24.04
█████████████   cat /readme
EOF

cat > /readme << 'EOF'
This Linux environment has minimal resources and lacks appropriate
security measures. It is not designed to handle personal or classified
data and exists for educational purposes only.
EOF

chmod 444 /readme
