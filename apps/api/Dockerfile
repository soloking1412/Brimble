FROM node:24-alpine

WORKDIR /app

RUN apk add --no-cache bash build-base curl docker-cli docker-cli-buildx git python3

ARG RAILPACK_VERSION=0.14.0
RUN curl -sSL https://railpack.com/install.sh | RAILPACK_VERSION=${RAILPACK_VERSION} sh -s -- --bin-dir /usr/local/bin

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY examples examples

RUN npm ci

COPY apps/api apps/api

RUN npm run build -w apps/api

CMD ["npm", "run", "start", "-w", "apps/api"]
