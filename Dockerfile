#FROM oven/bun:latest
FROM oven/bun:alpine
ADD ./ ./
RUN mkdir -p /data
WORKDIR /data
CMD ["bun", "run", "/home/bun/app/src/index.js"]