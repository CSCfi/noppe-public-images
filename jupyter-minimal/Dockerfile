FROM quay.io/jupyter/minimal-notebook:notebook-7.1.3

LABEL org.opencontainers.image.authors="Noppe Team <noppe-admin@csc.fi>"

USER root

ENV HOME /home/$NB_USER

RUN echo "ssh-client and less from apt" \
    && apt-get update \
    && apt-get install -y ssh-client less \
    && apt-get clean \

RUN echo "g++ from apt" \
    && apt-get update \
    && apt-get install -y g++ \
    && apt-get clean

# disable announcement extension to get rid of newsletter subscription pop-up
RUN jupyter labextension disable "@jupyterlab/apputils-extension:announcements"

# Switch back to jovyan user
USER $NB_USER
