# Fly.io · Railway · Koyeb · Cloud Run 등 도커를 받는 모든 호스팅에서 쓸 수 있습니다.
FROM node:20-alpine

WORKDIR /app

# 의존성 먼저 복사해 캐시를 활용
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY public ./public

# 퀴즈·점수 저장 위치 (호스팅에 영구 디스크를 붙이면 이 경로에 마운트하세요)
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server/index.js"]
