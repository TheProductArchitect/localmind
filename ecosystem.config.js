module.exports = {
  apps: [
    {
      name: "localmind",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000",
      cwd: process.env.HOME + "/LocalMind",
      env: {
        NODE_ENV: "production",
        LOCALMIND_HOST: "127.0.0.1",
      },
      max_restarts: 10,
      autorestart: true,
      watch: false,
    },
    {
      name: "localmind-worker",
      script: "worker.js",
      cwd: process.env.HOME + "/LocalMind",
      env: {
        NODE_ENV: "production",
        PORT: "3000",
      },
      max_restarts: 10,
      autorestart: true,
      watch: false,
    },
  ],
};
