import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A pasta-pai (source/repos) não é um repositório git, então o Turbopack sobe
  // demais procurando a raiz e reclama do package-lock de fora. Fixa aqui.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
