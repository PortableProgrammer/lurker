FROM oven/bun:1
ADD ./ ./
RUN mkdir -p /data
WORKDIR /data
CMD ["bun", "run", "/home/bun/app/src/index.js"]