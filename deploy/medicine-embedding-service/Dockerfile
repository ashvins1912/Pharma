FROM node:20-slim
ENV NODE_ENV=production HF_HOME=/var/cache/huggingface
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
EXPOSE 8080
CMD ["node","src/server.js"]
