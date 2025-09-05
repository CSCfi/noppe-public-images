FROM quay.io/jupyter/minimal-notebook:notebook-7.1.3

LABEL org.opencontainers.image.authors="Noppe Team <noppe-admin@csc.fi>"

USER root

ENV HOME /home/$NB_USER

RUN echo "ssh-client and less from apt" \
    && apt-get update \
    && apt-get install -y ssh-client less \
    && apt-get clean

RUN echo "graphviz from apt" \
    && apt-get update \
    && apt-get install -y graphviz \
    && apt-get clean

RUN echo "g++ from apt" \
    && apt-get update \
    && apt-get install -y g++ \
    && apt-get clean

USER $NB_USER

RUN echo "upgrade pip and setuptools" \
    && pip --no-cache-dir install --upgrade pip setuptools

RUN echo "openai" \
    && pip --no-cache-dir install openai==1.66.5

RUN echo "langchain" \
    && pip --no-cache-dir install langchain==0.3.27

RUN echo "sentence-transformers" \
    && pip --no-cache-dir install sentence-transformers==5.1.0

RUN echo "transformers" \
    && pip --no-cache-dir install transformers==4.55.4

RUN echo "aitta-client" \
    && pip --no-cache-dir install aitta-client==0.2.2

RUN echo "faiss-cpu" \
    && pip --no-cache-dir install faiss-cpu==1.12.0

# disable announcement extension to get rid of newsletter subscription pop-up
RUN jupyter labextension disable "@jupyterlab/apputils-extension:announcements"