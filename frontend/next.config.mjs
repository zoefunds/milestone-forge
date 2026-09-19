/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    // @reown/appkit-adapter-wagmi pulls in @wagmi/connectors' Coinbase
    // "Base Account" / x402 payments connector and MetaMask SDK's newer
    // connect-evm transport as optional peer features. Milestone Forge
    // settles exclusively in GEN through the Intelligent Contract via
    // plain injected/WalletConnect wallets — it never uses Base Pay or
    // x402 payments — so these optional branches are stubbed out rather
    // than pulling in unused third-party payment SDKs.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@coinbase/cdp-sdk": false,
      "@base-org/account": false,
      "@metamask/connect-evm": false,
      "@wagmi/core/tempo": false,
    };
    return config;
  },
};

export default nextConfig;
