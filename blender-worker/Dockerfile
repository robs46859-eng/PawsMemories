# Use a Debian-based slim node image
FROM node:20-slim

# Update package list and install Blender (along with its dependencies)
RUN apt-get update && \
    apt-get install -y blender libegl1 python3-numpy && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Fix numpy 1.24+ compatibility issue in Blender's gltf importer (np.bool, np.float, np.int were removed)
RUN find /usr/share/blender/scripts/addons/io_scene_gltf2/ -type f -name "*.py" -exec sed -i 's/np\.bool/bool/g' {} + || true
RUN find /usr/share/blender/scripts/addons/io_scene_gltf2/ -type f -name "*.py" -exec sed -i 's/np\.float/float/g' {} + || true
RUN find /usr/share/blender/scripts/addons/io_scene_gltf2/ -type f -name "*.py" -exec sed -i 's/np\.int/int/g' {} + || true

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
