# Use a Debian-based slim node image
FROM node:20-slim

# Update package list and install Blender (along with its dependencies)
RUN apt-get update && \
    apt-get install -y blender && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Set the working directory in the container
WORKDIR /app

# Copy package info and install node dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the application code
COPY . .

# Expose the port Express will run on
EXPOSE 10000

# Start the microservice
CMD ["npm", "start"]
