FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
COPY backend/package*.json ./backend/
COPY services/admin-control-plane/package.json ./services/admin-control-plane/
RUN npm install --omit=dev
COPY backend ./backend
COPY services/admin-control-plane ./services/admin-control-plane
ENV NODE_ENV=production
WORKDIR /app/services/admin-control-plane
CMD ["npm", "start"]
