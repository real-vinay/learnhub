# Electron Application

![Electron Version](https://img.shields.io/badge/Electron-28.1.0-blue.svg)
![Node Version](https://img.shields.io/badge/Node-20.9.0-green.svg)

A modern Electron application with Tailwind CSS integration.

## Project Structure

```
electron-app/
├── main.js          # Main process script
├── renderer.js      # Renderer process script
├── styles.css       # Main stylesheet
├── tailwind.config.js # Tailwind configuration
├── package.json     # Project dependencies and scripts
└── index.html       # Main window content
```

## Features

- Cross-platform desktop application
- Integrated with Tailwind CSS
- Automatic updates support
- Custom window controls

## Installation

```bash
npm install
```

## Running the Application

```bash
npm start
```

## Building for Production

```bash
npm run build
```

## Development

To watch Tailwind CSS changes:

```bash
npm run watch:tailwind
```

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT © [Your Name]
