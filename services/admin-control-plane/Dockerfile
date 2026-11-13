FROM node:22-alpine
WORKDIR /workspace
# Build with the repository root as the Docker build context so npm workspaces
# and the backend modules reused by the admin service are available.
COPY . .
RUN npm install --omit=dev
ENV NODE_ENV=production
EXPOSE 10000
CMD ["npm", "--workspace", "services/admin-control-plane", "start"]
