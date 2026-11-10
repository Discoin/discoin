FROM node:22-alpine AS build

WORKDIR /app/apps/frontend

COPY package.json /app/package.json
COPY apps/frontend/package*.json ./
RUN npm install

COPY apps/frontend/ ./
RUN npm run build

FROM nginx:alpine

COPY apps/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/frontend/dist /usr/share/nginx/html

EXPOSE 80
