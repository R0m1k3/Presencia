FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=4790
EXPOSE 4790

CMD ["node", "src/index.js"]
