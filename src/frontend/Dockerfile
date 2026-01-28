FROM registry.cn-hangzhou.aliyuncs.com/magicalion/node:20-alpine as frontend_build
ARG BACKEND
WORKDIR /app
COPY . /app
RUN cd /app/platform && npm install --registry=https://registry.npmmirror.com && npm run build
RUN cd /app/client && npm install --registry=https://registry.npmmirror.com && npm run build

FROM registry.cn-hangzhou.aliyuncs.com/magicalion/nginx:latest
COPY --from=frontend_build /app/platform/build/ /usr/share/nginx/html/platform
COPY --from=frontend_build /app/client/build/ /usr/share/nginx/html/client
COPY /nginx.conf /etc/nginx/conf.d/default.conf
