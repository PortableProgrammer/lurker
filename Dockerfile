FROM oven/bun:latest
ADD ./ ./
RUN mkdir -p /data
WORKDIR /data
EXPOSE 3000/tcp
CMD ["bun", "run", "/home/bun/app/src/index.js"]