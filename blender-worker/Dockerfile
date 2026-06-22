# Use a Debian-based slim node image
FROM node:20-slim

# Update package list and install dependencies for headless Blender
RUN apt-get update && \
    apt-get install -y wget xz-utils libx11-6 libxi6 libxxf86vm1 libxrender1 libgl1 libegl1 libxkbcommon0 libsm6 libxext6 && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Download and install Blender 5.1.2
RUN wget https://download.blender.org/release/Blender5.1/blender-5.1.2-linux-x64.tar.xz && \
    tar -xvf blender-5.1.2-linux-x64.tar.xz -C /usr/local/ && \
    ln -s /usr/local/blender-5.1.2-linux-x64/blender /usr/bin/blender && \
    rm blender-5.1.2-linux-x64.tar.xz

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
