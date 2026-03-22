# -------- Stage 1: Build --------
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package info and install ALL dependencies (including dev) to allow compilation
COPY package*.json ./
RUN npm install

# Generate Prisma Client
COPY prisma ./prisma/
RUN npx prisma generate

# Copy source code and build it
COPY . .
RUN npm run build


# -------- Stage 2: Production --------
FROM node:20-alpine

WORKDIR /app

# Copy package info and ONLY install production dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy compiled code and generated Prisma artifacts from the builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

EXPOSE 4000

# Push DB schema (for learning/devps) and start the compiled server
CMD sh -c "npx prisma db push && node dist/index.js"
