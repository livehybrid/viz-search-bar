const path = require('path');
module.exports = {
    entry: './src/index.jsx',
    output: { path: __dirname, filename: 'visualization.js' },
    resolve: { extensions: ['.js', '.jsx'] },
    module: {
        rules: [
            { test: /\.(js|jsx)$/, exclude: /node_modules/, use: 'babel-loader' },
        ],
    },
    performance: { hints: false },
    stats: 'minimal',
};
