FROM node:20-alpine

WORKDIR /app

# Install from the lockfile so the image gets exactly the tested versions.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

ENV NODE_ENV=production
ENV PORT=4790
EXPOSE 4790

# Run as the unprivileged user shipped with the node image, not root.
USER node

CMD ["node", "src/index.js"]
