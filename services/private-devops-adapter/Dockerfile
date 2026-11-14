FROM hashicorp/terraform:1.9.8 AS terraform
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache ca-certificates curl
COPY --from=terraform /bin/terraform /usr/local/bin/terraform
ARG TARGETARCH=amd64
RUN set -eux; \
    curl -fsSLo /usr/local/bin/kubectl https://dl.k8s.io/release/v1.32.2/bin/linux/${TARGETARCH}/kubectl; \
    curl -fsSLo /tmp/kubectl.sha256 https://dl.k8s.io/release/v1.32.2/bin/linux/${TARGETARCH}/kubectl.sha256; \
    echo "$(cat /tmp/kubectl.sha256)  /usr/local/bin/kubectl" | sha256sum -c -; \
    chmod 0755 /usr/local/bin/kubectl; \
    rm -f /tmp/kubectl.sha256
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY . .
USER node
EXPOSE 8092
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8092)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","server.js"]
