/** @type {import('next').NextConfig} */
const nextConfig = {
    turbopack: {},
    serverExternalPackages: ['@mtcute/node', '@mtcute/core', '@mtcute/wasm'],
    experimental: {
        serverActions: {
            bodySizeLimit: '2gb',
        },
    },
    webpack: (config) => {
        config.experiments = {
            ...config.experiments,
            asyncWebAssembly: true,
            layers: true,
        };
        return config;
    },
};

export default nextConfig;
