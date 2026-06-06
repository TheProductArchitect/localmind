# Contributing to LocalMind

First off, thank you for considering contributing to LocalMind! We welcome community contributions to make the project better.

## Ground Rules

- Ensure your code follows the existing style and conventions.
- Make sure to add comments and documentation for new features.
- Keep pull requests focused on a single feature or bug fix.

## Getting Started

1. **Fork the repository** on GitHub.
2. **Clone your fork** locally: `git clone https://github.com/YOUR_USERNAME/LocalMind.git`
3. **Install dependencies**: `npm install`
4. **Run the development server**: `npm run dev`

## Making Changes

1. **Create a branch**: `git checkout -b feature/your-feature-name` or `bugfix/issue-description`
2. **Make your changes**. 
3. **Test your code**: 
   - `npm run lint` to check for style issues.
   - `npm run build` to ensure the project still builds.
   - `npm run test:isolation` to run isolated checks.
4. **Commit your changes**: `git commit -m "Add some feature"`
5. **Push to the branch**: `git push origin feature/your-feature-name`
6. **Open a Pull Request** against the `main` branch.

## Code Review Process

- We use GitHub Actions to enforce automated checks (linting, building, formatting) on all pull requests.
- Your code must pass all continuous integration (CI) checks before it can be merged.
- At least one core maintainer must review and approve your code.
- If changes are requested, please address them by adding new commits to your branch.

Happy coding and thanks again!
