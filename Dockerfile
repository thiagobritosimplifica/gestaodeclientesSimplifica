FROM nginx:alpine

COPY index.html app.js style.css logo.png /usr/share/nginx/html/

EXPOSE 80
