# Password Visibility Toggle (Show / Hide Password)

## Summary of Changes
Added an interactive password visibility toggle button on the login screen (and employee account creation modal) using **closed eye (with slash)** and **open eye** SVG icons.

---

## What Was Added

### 1. HTML ([`index.html`](file:///c:/Users/user/P-P/OpenFloat%20POS%20X/index.html#L39-L55))
- Wrapped the password input in `.password-input-wrap`.
- Added the toggle button `#login-password-toggle` with two SVG icons:
  - **`#eye-icon-closed`**: Displayed by default when the input is masked (`type="password"`).
  - **`#eye-icon-open`**: Displayed when the password is revealed (`type="text"`).
- Also added the matching toggle on the **Employee Provisioning Modal** (`#emp-login-password`).

### 2. CSS ([`css/style.css`](file:///c:/Users/user/P-P/OpenFloat%20POS%20X/css/style.css#L901-L935))
- Positioned `.password-toggle-btn` inside the input with hover highlight and appropriate right padding on the input so text never overlaps the icon.

### 3. JavaScript Handlers ([`js/app.js`](file:///c:/Users/user/P-P/OpenFloat%20POS%20X/js/app.js#L70-L115))
- **`toggleLoginPasswordVisibility()`**: Switches input between `password` and `text`, dynamically swapping the closed/open eye icons.
- **`toggleEmpPasswordVisibility()`**: Handles password visibility toggle for employee accounts.
