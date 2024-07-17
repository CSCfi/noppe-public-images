FROM quay.io/jupyter/datascience-notebook:notebook-7.1.3

LABEL org.opencontainers.image.authors="Noppe Team <notebooks-admin@csc.fi>"

USER root

RUN echo "ssh-client and less from apt" \
    && apt-get update \
    && apt-get install -y ssh-client less \
    && apt-get clean

RUN echo "g++ from apt" \
    && apt-get update \
    && apt-get install -y g++ \
    && apt-get clean

# disable announcement extension to get rid of newsletter subscription pop-up
RUN jupyter labextension disable "@jupyterlab/apputils-extension:announcements"

USER $NB_USER
