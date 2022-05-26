FROM node:17.6-bullseye

RUN apt-key adv --keyserver keyserver.ubuntu.com --recv-keys C208ADDE26C2B797 && \
    ( echo "deb http://downloads.linux.HPE.com/SDR/repo/mcp/ bullseye/current non-free" > /etc/apt/sources.list.d/proliant.sources.list ) && \
    apt-get update && \
    apt-get install -y ssacli tini

WORKDIR /metric

RUN npm init -y && npm install express

ENV PORT=8080

COPY index.js .

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "index.js"]
