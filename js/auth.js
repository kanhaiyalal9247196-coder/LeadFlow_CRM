/* LeadFlow CRM - Authentication */
const Auth = (() => {
  const SESSION_KEY = 'leadflow_session';
  const REMEMBER_KEY = 'leadflow_remember';
  let currentUser = null;
  let sessionTimer = null;
  let lastActivity = Date.now();

  async function ensureSetup() {
    const users = await DB.getAll('users');
    return users.length === 0;
  }

  async function createInitialAdmin(data) {
    const needsSetup = await ensureSetup();
    if (!needsSetup) throw new Error('Setup already completed. Administrator exists.');

    if (!data.username || data.username.trim().length < 3) {
      throw new Error('Username must be at least 3 characters.');
    }
    if (!data.password || data.password.length < 6) {
      throw new Error('Password must be at least 6 characters.');
    }
    if (data.password !== data.confirmPassword) {
      throw new Error('Passwords do not match.');
    }
    if (!data.name || !data.name.trim()) {
      throw new Error('Full name is required.');
    }
    if (!data.securityQuestion || !data.securityAnswer) {
      throw new Error('Security question and answer are required for password recovery.');
    }

    const salt = Utils.generateSalt();
    const passwordHash = await Utils.hashPassword(data.password, salt);
    const answerSalt = Utils.generateSalt();
    const answerHash = await Utils.hashPassword(data.securityAnswer.trim().toLowerCase(), answerSalt);

    const admin = {
      id: Utils.uid(),
      username: data.username.trim().toLowerCase(),
      name: data.name.trim(),
      email: (data.email || '').trim(),
      role: 'Admin',
      active: true,
      passwordHash,
      salt,
      securityQuestion: data.securityQuestion,
      securityAnswerHash: answerHash,
      securityAnswerSalt: answerSalt,
      createdAt: Utils.now(),
      updatedAt: Utils.now(),
      lastLogin: null
    };

    await DB.add('users', admin);

    // Default settings
    await DB.setSetting('companyName', data.companyName || 'LeadFlow CRM');
    await DB.setSetting('companyAddress', '');
    await DB.setSetting('companyPhone', '');
    await DB.setSetting('companyEmail', data.email || '');
    await DB.setSetting('sessionTimeout', 30);
    await DB.setSetting('maxUploadSize', 5);
    await DB.setSetting('theme', 'light');
    await DB.setSetting('browserNotifications', true);
    await DB.setSetting('followupReminderHours', 24);
    await DB.setSetting('paymentReminderDays', 3);
    await DB.setSetting('schemaVersion', Utils.SCHEMA_VERSION);
    await DB.setSetting('appVersion', Utils.APP_VERSION);
    await DB.setSetting('setupCompleted', true);
    await DB.setSetting('appSignature', 'leadflow-' + Utils.APP_VERSION);

    await Audit.log({
      userId: admin.id,
      userName: admin.name,
      role: admin.role,
      action: 'User Created',
      description: 'Initial administrator account created during setup',
      leadId: null
    });

    return admin;
  }

  async function login(username, password, remember = false) {
    if (!username || !password) throw new Error('Username and password are required.');

    const user = await DB.getOneByIndex('users', 'username', username.trim().toLowerCase());
    if (!user) throw new Error('Invalid username or password.');
    if (!user.active) throw new Error('Your account has been deactivated. Contact an administrator.');

    const hash = await Utils.hashPassword(password, user.salt);
    if (hash !== user.passwordHash) {
      await logLoginActivity(user.id, user.username, false, 'Invalid password');
      throw new Error('Invalid username or password.');
    }

    user.lastLogin = Utils.now();
    await DB.put('users', user);

    currentUser = sanitizeUser(user);
    saveSession(remember);
    startSessionTimer();
    await logLoginActivity(user.id, user.username, true, 'Login successful');

    await Audit.log({
      userId: user.id,
      userName: user.name,
      role: user.role,
      action: 'Login',
      description: 'User logged in',
      leadId: null
    });

    return currentUser;
  }

  async function logout() {
    if (currentUser) {
      await Audit.log({
        userId: currentUser.id,
        userName: currentUser.name,
        role: currentUser.role,
        action: 'Logout',
        description: 'User logged out',
        leadId: null
      });
      await logLoginActivity(currentUser.id, currentUser.username, true, 'Logout');
    }
    currentUser = null;
    clearSession();
    stopSessionTimer();
  }

  function sanitizeUser(user) {
    return {
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email || '',
      role: user.role,
      active: user.active,
      securityQuestion: user.securityQuestion || ''
    };
  }

  function saveSession(remember) {
    const session = {
      userId: currentUser.id,
      username: currentUser.username,
      loginAt: Utils.now(),
      lastActivity: Utils.now()
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    if (remember) {
      localStorage.setItem(REMEMBER_KEY, JSON.stringify({ userId: currentUser.id, username: currentUser.username }));
    } else {
      localStorage.removeItem(REMEMBER_KEY);
    }
  }

  function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
  }

  async function restoreSession() {
    try {
      let sessionData = sessionStorage.getItem(SESSION_KEY);
      if (!sessionData) {
        const remembered = localStorage.getItem(REMEMBER_KEY);
        if (remembered) {
          const rem = JSON.parse(remembered);
          const user = await DB.get('users', rem.userId);
          if (user && user.active) {
            currentUser = sanitizeUser(user);
            saveSession(true);
            startSessionTimer();
            return currentUser;
          }
        }
        return null;
      }
      const session = JSON.parse(sessionData);
      const user = await DB.get('users', session.userId);
      if (!user || !user.active) {
        clearSession();
        return null;
      }

      // Check timeout
      const timeout = await DB.getSetting('sessionTimeout', 30);
      const lastAct = new Date(session.lastActivity).getTime();
      if (Date.now() - lastAct > timeout * 60 * 1000) {
        clearSession();
        return null;
      }

      currentUser = sanitizeUser(user);
      touchActivity();
      startSessionTimer();
      return currentUser;
    } catch (e) {
      clearSession();
      return null;
    }
  }

  function getCurrentUser() {
    return currentUser;
  }

  function isLoggedIn() {
    return !!currentUser;
  }

  function touchActivity() {
    lastActivity = Date.now();
    const sessionData = sessionStorage.getItem(SESSION_KEY);
    if (sessionData) {
      try {
        const session = JSON.parse(sessionData);
        session.lastActivity = Utils.now();
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
      } catch (_) {}
    }
  }

  async function startSessionTimer() {
    stopSessionTimer();
    const check = async () => {
      if (!currentUser) return;
      const timeout = await DB.getSetting('sessionTimeout', 30);
      if (Date.now() - lastActivity > timeout * 60 * 1000) {
        await logout();
        if (typeof App !== 'undefined') App.onSessionTimeout();
      }
    };
    sessionTimer = setInterval(check, 30000);
  }

  function stopSessionTimer() {
    if (sessionTimer) {
      clearInterval(sessionTimer);
      sessionTimer = null;
    }
  }

  async function changePassword(userId, currentPassword, newPassword) {
    const user = await DB.get('users', userId);
    if (!user) throw new Error('User not found.');

    if (currentUser.id === userId) {
      const hash = await Utils.hashPassword(currentPassword, user.salt);
      if (hash !== user.passwordHash) throw new Error('Current password is incorrect.');
    } else if (currentUser.role !== 'Admin') {
      throw new Error('Permission denied.');
    }

    if (!newPassword || newPassword.length < 6) {
      throw new Error('New password must be at least 6 characters.');
    }

    const salt = Utils.generateSalt();
    user.passwordHash = await Utils.hashPassword(newPassword, salt);
    user.salt = salt;
    user.updatedAt = Utils.now();
    await DB.put('users', user);

    await Audit.log({
      userId: currentUser.id,
      userName: currentUser.name,
      role: currentUser.role,
      action: 'User Updated',
      description: `Password changed for user: ${user.username}`,
      leadId: null
    });
  }

  async function resetPassword(userId, newPassword) {
    if (!currentUser || currentUser.role !== 'Admin') throw new Error('Only Admin can reset passwords.');
    const user = await DB.get('users', userId);
    if (!user) throw new Error('User not found.');
    if (!newPassword || newPassword.length < 6) throw new Error('Password must be at least 6 characters.');

    const salt = Utils.generateSalt();
    user.passwordHash = await Utils.hashPassword(newPassword, salt);
    user.salt = salt;
    user.updatedAt = Utils.now();
    await DB.put('users', user);

    await Audit.log({
      userId: currentUser.id,
      userName: currentUser.name,
      role: currentUser.role,
      action: 'User Updated',
      description: `Password reset for user: ${user.username}`,
      leadId: null
    });
  }

  async function recoverPassword(username, securityAnswer, newPassword) {
    const user = await DB.getOneByIndex('users', 'username', username.trim().toLowerCase());
    if (!user) throw new Error('User not found.');
    if (!user.securityAnswerHash || !user.securityAnswerSalt) {
      throw new Error('Security question not configured for this account. Contact administrator.');
    }

    const answerHash = await Utils.hashPassword(securityAnswer.trim().toLowerCase(), user.securityAnswerSalt);
    if (answerHash !== user.securityAnswerHash) {
      throw new Error('Incorrect security answer.');
    }

    if (!newPassword || newPassword.length < 6) {
      throw new Error('New password must be at least 6 characters.');
    }

    const salt = Utils.generateSalt();
    user.passwordHash = await Utils.hashPassword(newPassword, salt);
    user.salt = salt;
    user.updatedAt = Utils.now();
    await DB.put('users', user);

    await Audit.log({
      userId: user.id,
      userName: user.name,
      role: user.role,
      action: 'User Updated',
      description: 'Password recovered via security question',
      leadId: null
    });

    return true;
  }

  async function getSecurityQuestion(username) {
    const user = await DB.getOneByIndex('users', 'username', username.trim().toLowerCase());
    if (!user) throw new Error('User not found.');
    if (!user.securityQuestion) throw new Error('No security question set for this account.');
    return user.securityQuestion;
  }

  async function updateProfile(data) {
    if (!currentUser) throw new Error('Not authenticated.');
    const user = await DB.get('users', currentUser.id);
    if (!user) throw new Error('User not found.');

    if (data.name) user.name = data.name.trim();
    if (data.email !== undefined) user.email = data.email.trim();

    if (data.securityQuestion && data.securityAnswer) {
      user.securityQuestion = data.securityQuestion;
      const answerSalt = Utils.generateSalt();
      user.securityAnswerHash = await Utils.hashPassword(data.securityAnswer.trim().toLowerCase(), answerSalt);
      user.securityAnswerSalt = answerSalt;
    }

    user.updatedAt = Utils.now();
    await DB.put('users', user);
    currentUser = sanitizeUser(user);
    saveSession(!!localStorage.getItem(REMEMBER_KEY));

    await Audit.log({
      userId: currentUser.id,
      userName: currentUser.name,
      role: currentUser.role,
      action: 'User Updated',
      description: 'Profile updated',
      leadId: null
    });

    return currentUser;
  }

  async function logLoginActivity(userId, username, success, detail) {
    try {
      await DB.add('loginActivity', {
        id: Utils.uid(),
        userId,
        username,
        success,
        detail,
        timestamp: Utils.now(),
        userAgent: navigator.userAgent.slice(0, 200)
      });
    } catch (_) {}
  }

  // Track user activity
  ['click', 'keypress', 'scroll', 'mousemove'].forEach(evt => {
    document.addEventListener(evt, () => {
      if (currentUser) touchActivity();
    }, { passive: true });
  });

  return {
    ensureSetup, createInitialAdmin, login, logout, restoreSession,
    getCurrentUser, isLoggedIn, changePassword, resetPassword,
    recoverPassword, getSecurityQuestion, updateProfile, touchActivity
  };
})();