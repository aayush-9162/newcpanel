// PM2 process config for the CFC Cpanel server.
// One Express process serves BOTH the API and the built React app on PORT
// (from server/.env, default 1215).
//
// Deploy flow on the server:
//   git pull
//   npm install            # only if dependencies changed
//   pm2 start ecosystem.config.cjs   # first time
//   pm2 restart cfc-cpanel           # subsequent updates
//   pm2 save                         # persist across reboots (after `pm2 startup`)
//
// Handy: pm2 logs cfc-cpanel · pm2 status · pm2 stop cfc-cpanel

module.exports = {
  apps: [
    {
      name: 'cfc-cpanel',
      script: 'src/index.js',
      cwd: __dirname,            // run from server/ so dotenv loads server/.env
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '400M',
      env: {
        NODE_ENV: 'production',
        // PORT is read from server/.env. Uncomment to force it here instead:
        // PORT: 1215,
      },
    },
  ],
};
