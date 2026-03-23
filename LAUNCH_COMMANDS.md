# Launch Commands for World Monitor

Follow these steps to set up and run the World Monitor dashboard in an isolated environment.

## 1. Environment Isolation (Virtual Environment)
To keep your global system clean and ensure you are using the correct dependencies:

### Node Version Manager (nvm)
This project requires Node 22 (as specified in `.nvmrc`).
```bash
nvm install # Installs the version in .nvmrc if not present
nvm use     # Activates the version in .nvmrc for this session
```

### Local Dependencies
In Node.js, the "virtual environment" for packages is managed automatically via the `node_modules` directory in the project root.
```bash
npm install
```

## 2. Launching the Application
You can run the application in different variants depending on your needs.

### Full Variant (Default)
Starts the complete dashboard with all features:
```bash
npm run dev
```

### Technology Variant
Starts a technology-focused subset:
```bash
npm run dev:tech
```

### Financial Variant
Starts the financial markets version:
```bash
npm run dev:finance
```

### Commodity Variant
Starts the commodity markets version:
```bash
npm run dev:commodity
```

### Happy Variant
Starts the dashboard with positive news only:
```bash
npm run dev:happy
```

## 3. Development Utilities

### Type Checking
Run the TypeScript compiler in no-emit mode to check for errors:
```bash
npm run typecheck
```

### Testing
Run unit and integration tests:
```bash
npm run test:data
```

### Protocol Buffers
If you modify any `.proto` files, regenerate the client/server stubs:
```bash
make generate
```

## 4. Documentation
For more detailed information, visit:
- **Local Docs:** `CONTRIBUTING.md`, `ARCHITECTURE.md`, and `AGENTS.md`
- **Online Docs:** [docs.worldmonitor.app](https://docs.worldmonitor.app)
