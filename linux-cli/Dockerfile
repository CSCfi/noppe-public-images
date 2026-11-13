FROM docker.io/library/caddy:2.8-alpine AS caddy
# The empty bounding set in start.sh cannot exec a file-capability binary.
RUN setcap -r /usr/bin/caddy

FROM docker.io/library/ubuntu:24.04

# Environment variables
ARG USERNAME=user
ENV USERNAME=${USERNAME}

# Install container software
COPY --chmod=500 ./configs/install_os_sw.sh /install_os_sw.sh
COPY ./configs/slurm.conf /slurm.conf
RUN /install_os_sw.sh && rm /install_os_sw.sh

# Copy Caddy binary from official image
COPY --from=caddy /usr/bin/caddy /usr/bin/caddy

# Add web content
COPY ./html/ /app/
COPY ./configs/Caddyfile /etc/caddy/Caddyfile
COPY ./content/ /app/content

RUN chmod 644 /etc/caddy/Caddyfile && chmod -R a+rX /app \
    && install -d -o "$USERNAME" -g "$USERNAME" /var/lib/caddy

COPY ./LICENSE        /usr/share/licenses/LICENSE
COPY ./licenses/      /usr/share/licenses/

# Copy the startup script
COPY --chmod=500 ./configs/start.sh /start

EXPOSE 8787

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/start"]
