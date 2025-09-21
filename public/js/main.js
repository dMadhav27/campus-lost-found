// Campus Lost & Found - Main JavaScript

class CampusLostFound {
    constructor() {
        this.API_BASE = '/api';
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.checkAuthentication();
    }

    setupEventListeners() {
        // Form submissions
        const signupForm = document.getElementById('signupForm');
        const loginForm = document.getElementById('loginForm');
        const logoutBtn = document.getElementById('logoutBtn');

        if (signupForm) {
            signupForm.addEventListener('submit', (e) => this.handleSignup(e));
        }

        if (loginForm) {
            loginForm.addEventListener('submit', (e) => this.handleLogin(e));
        }

        if (logoutBtn) {
            logoutBtn.addEventListener('click', (e) => this.handleLogout(e));
        }

        // Real-time validation
        this.setupRealTimeValidation();
    }

    setupRealTimeValidation() {
        // Email validation
        const emailInputs = document.querySelectorAll('input[type="email"]');
        emailInputs.forEach(input => {
            input.addEventListener('input', (e) => this.validateEmail(e.target));
        });

        // Password validation
        const passwordInputs = document.querySelectorAll('input[type="password"]');
        passwordInputs.forEach(input => {
            if (input.name === 'password') {
                input.addEventListener('input', (e) => this.validatePassword(e.target));
            }
        });

        // Confirm password validation
        const confirmPasswordInput = document.querySelector('input[name="confirmPassword"]');
        if (confirmPasswordInput) {
            confirmPasswordInput.addEventListener('input', (e) => this.validateConfirmPassword(e.target));
        }
    }

    validateEmail(input) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const isValid = emailRegex.test(input.value);
        
        this.setFieldValidation(input, isValid, isValid ? 'Valid email' : 'Please enter a valid email');
        return isValid;
    }

    validatePassword(input) {
        const password = input.value;
        const minLength = password.length >= 6;
        const hasUpper = /[A-Z]/.test(password);
        const hasLower = /[a-z]/.test(password);
        const hasNumber = /\d/.test(password);
        
        const isValid = minLength && hasUpper && hasLower && hasNumber;
        
        let message = '';
        if (!minLength) message = 'Password must be at least 6 characters';
        else if (!hasUpper) message = 'Password must contain uppercase letter';
        else if (!hasLower) message = 'Password must contain lowercase letter';
        else if (!hasNumber) message = 'Password must contain a number';
        else message = 'Strong password';
        
        this.setFieldValidation(input, isValid, message);
        return isValid;
    }

    validateConfirmPassword(input) {
        const password = document.querySelector('input[name="password"]').value;
        const isValid = input.value === password;
        
        this.setFieldValidation(input, isValid, isValid ? 'Passwords match' : 'Passwords do not match');
        return isValid;
    }

    setFieldValidation(input, isValid, message) {
        const formGroup = input.closest('.form-group');
        let messageEl = formGroup.querySelector('.validation-message');
        
        if (!messageEl) {
            messageEl = document.createElement('div');
            messageEl.className = 'validation-message';
            formGroup.appendChild(messageEl);
        }
        
        input.classList.remove('success', 'error');
        messageEl.classList.remove('message-success', 'message-error', 'show');
        
        if (input.value.length > 0) {
            input.classList.add(isValid ? 'success' : 'error');
            messageEl.classList.add(isValid ? 'message-success' : 'message-error', 'show');
            messageEl.textContent = message;
        }
    }

    async handleSignup(e) {
        e.preventDefault();
        
        const form = e.target;
        const formData = new FormData(form);
        const data = Object.fromEntries(formData.entries());
        
        // Client-side validation
        if (!this.validateSignupForm(data)) {
            return;
        }
        
        this.setLoadingState(form, true);
        
        try {
            const response = await fetch(`${this.API_BASE}/auth/signup`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data)
            });
            
            const result = await response.json();
            
            if (result.success) {
    // Store authentication data
    localStorage.setItem('authToken', result.token);
    localStorage.setItem('userData', JSON.stringify(result.user));
    
    this.showMessage('success', result.message);
    
    // Redirect based on role
    setTimeout(() => {
        if (result.user.role === 'admin') {
            window.location.href = '/admin-dashboard.html';
        } else {
            window.location.href = '/dashboard.html';
        }
    }, 1000);
} else {
                this.showMessage('error', result.error);
            }
            
        } catch (error) {
            console.error('Signup error:', error);
            this.showMessage('error', 'Network error. Please try again.');
        } finally {
            this.setLoadingState(form, false);
        }
    }

    async handleLogin(e) {
        e.preventDefault();
        
        const form = e.target;
        const formData = new FormData(form);
        const data = Object.fromEntries(formData.entries());
        
        this.setLoadingState(form, true);
        
        try {
            const response = await fetch(`${this.API_BASE}/auth/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data)
            });
            
            const result = await response.json();
            
            if (result.success) {
                // Store authentication data
                localStorage.setItem('authToken', result.token);
                localStorage.setItem('userData', JSON.stringify(result.user));
                
                this.showMessage('success', result.message);
                
                // Redirect to dashboard after 1 second
                setTimeout(() => {
                    window.location.href = '/dashboard.html';
                }, 1000);
                
            } else {
                this.showMessage('error', result.error);
            }
            
        } catch (error) {
            console.error('Login error:', error);
            this.showMessage('error', 'Network error. Please try again.');
        } finally {
            this.setLoadingState(form, false);
        }
    }

    async handleLogout(e) {
        e.preventDefault();
        
        const token = localStorage.getItem('authToken');
        
        if (token) {
            try {
                await fetch(`${this.API_BASE}/auth/logout`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    }
                });
            } catch (error) {
                console.error('Logout error:', error);
            }
        }
        
        // Clear local storage
        localStorage.removeItem('authToken');
        localStorage.removeItem('userData');
        
        // Redirect to home
        window.location.href = '/';
    }

    validateSignupForm(data) {
        let isValid = true;
        
        // Check required fields
        const requiredFields = ['firstName', 'lastName', 'studentId', 'email', 'password'];
        
        for (const field of requiredFields) {
            if (!data[field] || data[field].trim() === '') {
                this.showMessage('error', `${this.formatFieldName(field)} is required`);
                isValid = false;
                break;
            }
        }
        
        if (!isValid) return false;
        
        // Validate email
        if (!this.validateEmail(document.querySelector('input[name="email"]'))) {
            this.showMessage('error', 'Please enter a valid email address');
            return false;
        }
        
        // Validate password
        if (!this.validatePassword(document.querySelector('input[name="password"]'))) {
            this.showMessage('error', 'Password must be at least 6 characters with uppercase, lowercase, and number');
            return false;
        }
        
        // Validate confirm password
        if (data.confirmPassword && data.password !== data.confirmPassword) {
            this.showMessage('error', 'Passwords do not match');
            return false;
        }
        
        return true;
    }

    formatFieldName(field) {
        return field.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
    }

    setLoadingState(form, isLoading) {
        const submitBtn = form.querySelector('button[type="submit"]');
        const spinner = submitBtn.querySelector('.loading-spinner');
        const buttonText = submitBtn.querySelector('.btn-text');
        
        if (isLoading) {
            submitBtn.disabled = true;
            if (spinner) spinner.style.display = 'block';
            if (buttonText) buttonText.textContent = 'Please wait...';
        } else {
            submitBtn.disabled = false;
            if (spinner) spinner.style.display = 'none';
            if (buttonText) {
                const originalText = form.id === 'signupForm' ? 'Create Account' : 'Sign In';
                buttonText.textContent = originalText;
            }
        }
    }

    showMessage(type, message) {
        // Remove existing messages
        const existingMessages = document.querySelectorAll('.message');
        existingMessages.forEach(msg => msg.remove());
        
        // Create new message
        const messageEl = document.createElement('div');
        messageEl.className = `message message-${type} show fade-in`;
        messageEl.textContent = message;
        
        // Insert at top of form or page
        const form = document.querySelector('form');
        const container = form || document.querySelector('.auth-card') || document.querySelector('.container');
        
        if (container) {
            if (form) {
                form.insertBefore(messageEl, form.firstChild);
            } else {
                container.insertBefore(messageEl, container.firstChild);
            }
        }
        
        // Auto-hide success messages after 5 seconds
        if (type === 'success') {
            setTimeout(() => {
                messageEl.remove();
            }, 5000);
        }
    }

    checkAuthentication() {
    const token = localStorage.getItem('authToken');
    const userData = JSON.parse(localStorage.getItem('userData') || '{}');
    const currentPath = window.location.pathname;
    
    // Protected pages that require authentication
    const protectedPages = ['/dashboard.html', '/admin-dashboard.html'];
    
    // Public pages that redirect if already authenticated
    const publicPages = ['/login.html', '/signup.html'];
    
    // Admin-only pages
    const adminPages = ['/admin-dashboard.html'];
    
    if (protectedPages.includes(currentPath) && !token) {
        // Redirect to login if trying to access protected page without token
        window.location.href = '/login.html';
    } else if (adminPages.includes(currentPath) && userData.role !== 'admin') {
        // Redirect non-admins away from admin pages
        window.location.href = '/dashboard.html';
    } else if (publicPages.includes(currentPath) && token) {
        // Redirect to appropriate dashboard if already authenticated
        if (userData.role === 'admin') {
            window.location.href = '/admin-dashboard.html';
        } else {
            window.location.href = '/dashboard.html';
        }
    }
    
    // Update UI based on authentication status
    this.updateAuthUI(!!token);
}

    updateAuthUI(isAuthenticated) {
        const authButtons = document.querySelector('.auth-buttons');
        const userMenu = document.querySelector('.user-menu');
        
        if (isAuthenticated) {
            const userData = JSON.parse(localStorage.getItem('userData') || '{}');
            
            if (authButtons) {
                authButtons.style.display = 'none';
            }
            
            if (userMenu) {
                userMenu.style.display = 'block';
                const userName = userMenu.querySelector('.user-name');
                if (userName) {
                    userName.textContent = `${userData.firstName} ${userData.lastName}`;
                }
            }
            
            // Update dashboard if on dashboard page
            if (window.location.pathname === '/dashboard.html') {
                this.loadDashboard(userData);
            }
            
        } else {
            if (authButtons) {
                authButtons.style.display = 'flex';
            }
            
            if (userMenu) {
                userMenu.style.display = 'none';
            }
        }
    }

    async loadDashboard(userData) {
        // Update welcome message
        const welcomeName = document.querySelector('.welcome-name');
        if (welcomeName) {
            welcomeName.textContent = userData.firstName;
        }
        
        // Update user avatar
        const userAvatar = document.querySelector('.user-avatar');
        if (userAvatar) {
            const initials = `${userData.firstName[0]}${userData.lastName[0]}`.toUpperCase();
            userAvatar.textContent = initials;
        }
        
        // Load user stats (placeholder for now)
        this.loadUserStats();
    }

    async loadUserStats() {
        // This will be implemented when we add items functionality
        const statsCards = document.querySelectorAll('.stat-number');
        statsCards.forEach(card => {
            card.textContent = '0';
        });
    }

    // Utility method to make authenticated requests
    async makeAuthenticatedRequest(url, options = {}) {
        const token = localStorage.getItem('authToken');
        
        if (!token) {
            throw new Error('No authentication token found');
        }
        
        const headers = {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...options.headers
        };
        
        const response = await fetch(url, {
            ...options,
            headers
        });
        
        if (response.status === 401) {
            // Token expired or invalid
            this.handleLogout();
            return;
        }
        
        return response;
    }
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new CampusLostFound();
});

// Add smooth scrolling for anchor links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    });
});

// Add loading animation to page transitions
window.addEventListener('beforeunload', () => {
    document.body.style.opacity = '0.7';
});