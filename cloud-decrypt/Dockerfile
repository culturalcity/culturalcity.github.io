FROM node:22-slim

# Cloud Run 預期應用聽 $PORT（預設 8080）
ENV PORT=8080
ENV NODE_ENV=production

WORKDIR /app

# 先 copy 套件清單以利 docker layer cache
COPY package*.json ./
RUN npm ci --omit=dev

COPY index.js .

EXPOSE 8080
CMD ["node", "index.js"]
