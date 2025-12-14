/**
 * Hosting Mandiri - Frontend JavaScript
 * Handles form submissions, API calls, and UI interactions
 */

document.addEventListener('DOMContentLoaded', function() {
  initDeployForms();
  initNameValidation();
  initThemeToggle();
});

// Theme Toggle
function initThemeToggle() {
  const themeToggle = document.getElementById('themeToggle');
  if (!themeToggle) return;

  const savedTheme = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateThemeIcon(savedTheme);

  themeToggle.addEventListener('click', function() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    updateThemeIcon(newTheme);
  });
}

function updateThemeIcon(theme) {
  const themeToggle = document.getElementById('themeToggle');
  if (themeToggle) {
    const icon = themeToggle.querySelector('i');
    if (icon) {
      icon.className = theme === 'dark' ? 'bi bi-sun' : 'bi bi-moon-stars';
    }
  }
}

// Inisialisasi form deploy
function initDeployForms() {
  const githubForm = document.getElementById('github-deploy-form');
  const zipForm = document.getElementById('zip-deploy-form');
  
  if (githubForm) {
    githubForm.addEventListener('submit', handleGitHubDeploy);
  }
  
  if (zipForm) {
    zipForm.addEventListener('submit', handleZipDeploy);
  }
}

// Validasi nama aplikasi realtime
function initNameValidation() {
  const githubNameInput = document.getElementById('github-app-name');
  const zipNameInput = document.getElementById('zip-app-name');
  
  if (githubNameInput) {
    githubNameInput.addEventListener('blur', () => checkAppName(githubNameInput, 'github-name-feedback'));
  }
  
  if (zipNameInput) {
    zipNameInput.addEventListener('blur', () => checkAppName(zipNameInput, 'zip-name-feedback'));
  }
}

// Cek ketersediaan nama aplikasi
async function checkAppName(input, feedbackId) {
  const name = input.value.trim();
  const feedback = document.getElementById(feedbackId);
  
  if (name.length < 3) {
    feedback.textContent = 'Nama minimal 3 karakter';
    feedback.className = 'form-text text-warning';
    return;
  }
  
  try {
    const response = await fetch('/api/check-name/' + encodeURIComponent(name));
    const data = await response.json();
    
    if (data.available) {
      feedback.textContent = 'Nama tersedia: ' + data.sanitizedName;
      feedback.className = 'form-text text-success';
      input.classList.remove('is-invalid');
      input.classList.add('is-valid');
    } else {
      feedback.textContent = 'Nama sudah digunakan, pilih nama lain';
      feedback.className = 'form-text text-danger';
      input.classList.remove('is-valid');
      input.classList.add('is-invalid');
    }
  } catch (error) {
    feedback.textContent = 'Error memeriksa nama';
    feedback.className = 'form-text text-danger';
  }
}

// Handle deploy dari GitHub
async function handleGitHubDeploy(e) {
  e.preventDefault();
  
  const form = e.target;
  const submitBtn = document.getElementById('github-submit-btn');
  const repoUrl = document.getElementById('github-url').value.trim();
  const appName = document.getElementById('github-app-name').value.trim();
  
  if (!repoUrl || !appName) {
    showAlert('Harap isi semua field', 'danger');
    return;
  }
  
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Memproses...';
  showDeployModal('Cloning repository dari GitHub...');
  
  try {
    const response = await fetch('/api/deploy/github', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoUrl, appName })
    });
    
    const data = await response.json();
    hideDeployModal();
    
    if (data.success) {
      showAlert('Aplikasi berhasil di-deploy! Mengalihkan...', 'success');
      setTimeout(() => {
        window.location.href = '/apps/' + data.app.name;
      }, 1500);
    } else {
      showAlert(data.error || 'Gagal deploy aplikasi', 'danger');
    }
  } catch (error) {
    hideDeployModal();
    showAlert('Error: ' + error.message, 'danger');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i class="bi bi-cloud-download me-2"></i>Clone & Deploy';
  }
}

// Handle deploy dari ZIP
async function handleZipDeploy(e) {
  e.preventDefault();
  
  const form = e.target;
  const submitBtn = document.getElementById('zip-submit-btn');
  const fileInput = document.getElementById('zip-file');
  const appName = document.getElementById('zip-app-name').value.trim();
  
  if (!fileInput.files[0] || !appName) {
    showAlert('Harap isi semua field', 'danger');
    return;
  }
  
  const formData = new FormData();
  formData.append('zipFile', fileInput.files[0]);
  formData.append('appName', appName);
  
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Mengupload...';
  showDeployModal('Mengupload dan mengekstrak file ZIP...');
  
  try {
    const response = await fetch('/api/deploy/zip', {
      method: 'POST',
      body: formData
    });
    
    const data = await response.json();
    hideDeployModal();
    
    if (data.success) {
      showAlert('Aplikasi berhasil di-deploy! Mengalihkan...', 'success');
      setTimeout(() => {
        window.location.href = '/apps/' + data.app.name;
      }, 1500);
    } else {
      showAlert(data.error || 'Gagal deploy aplikasi', 'danger');
    }
  } catch (error) {
    hideDeployModal();
    showAlert('Error: ' + error.message, 'danger');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i class="bi bi-upload me-2"></i>Upload & Deploy';
  }
}

// App actions (start, stop, restart)
async function appAction(appName, action) {
  const actionNames = {
    start: 'Menjalankan',
    stop: 'Menghentikan',
    restart: 'Merestart'
  };
  
  showActionModal(actionNames[action] + ' aplikasi...');
  
  try {
    const response = await fetch('/api/apps/' + encodeURIComponent(appName) + '/' + action, {
      method: 'POST'
    });
    
    const data = await response.json();
    hideActionModal();
    
    if (data.success) {
      showAlert(data.message || 'Berhasil', 'success');
      setTimeout(() => location.reload(), 1000);
    } else {
      showAlert(data.error || 'Gagal melakukan aksi', 'danger');
    }
  } catch (error) {
    hideActionModal();
    showAlert('Error: ' + error.message, 'danger');
  }
}

// Delete app
async function deleteApp(appName) {
  if (!confirm('Apakah Anda yakin ingin menghapus aplikasi "' + appName + '"?\n\nTindakan ini tidak dapat dibatalkan!')) {
    return;
  }
  
  showActionModal('Menghapus aplikasi...');
  
  try {
    const response = await fetch('/api/apps/' + encodeURIComponent(appName), {
      method: 'DELETE'
    });
    
    const data = await response.json();
    hideActionModal();
    
    if (data.success) {
      showAlert('Aplikasi berhasil dihapus', 'success');
      setTimeout(() => {
        window.location.href = '/apps';
      }, 1000);
    } else {
      showAlert(data.error || 'Gagal menghapus aplikasi', 'danger');
    }
  } catch (error) {
    hideActionModal();
    showAlert('Error: ' + error.message, 'danger');
  }
}

// Show alert
function showAlert(message, type) {
  const alertDiv = document.getElementById('deploy-alert');
  if (alertDiv) {
    alertDiv.className = 'alert alert-' + type + ' fade-in';
    alertDiv.textContent = message;
    alertDiv.classList.remove('d-none');
    
    if (type === 'success') {
      setTimeout(() => alertDiv.classList.add('d-none'), 3000);
    }
  } else {
    const floatingAlert = document.createElement('div');
    floatingAlert.className = 'alert alert-' + type + ' position-fixed fade-in';
    floatingAlert.style.cssText = 'top: 80px; right: 20px; z-index: 9999; min-width: 300px; max-width: 90vw;';
    floatingAlert.innerHTML = message + '<button type="button" class="btn-close float-end" onclick="this.parentElement.remove()"></button>';
    document.body.appendChild(floatingAlert);
    
    setTimeout(() => floatingAlert.remove(), 5000);
  }
}

// Deploy modal
function showDeployModal(message) {
  const modal = document.getElementById('deployModal');
  if (modal) {
    const statusEl = document.getElementById('deploy-step');
    if (statusEl) statusEl.textContent = message;
    
    const bsModal = new bootstrap.Modal(modal, { backdrop: 'static', keyboard: false });
    bsModal.show();
  }
}

function hideDeployModal() {
  const modal = document.getElementById('deployModal');
  if (modal) {
    const bsModal = bootstrap.Modal.getInstance(modal);
    if (bsModal) bsModal.hide();
  }
}

// Action modal
function showActionModal(message) {
  const modal = document.getElementById('actionModal');
  if (modal) {
    const statusEl = document.getElementById('action-status');
    if (statusEl) statusEl.textContent = message;
    
    const bsModal = new bootstrap.Modal(modal, { backdrop: 'static', keyboard: false });
    bsModal.show();
  }
}

function hideActionModal() {
  const modal = document.getElementById('actionModal');
  if (modal) {
    const bsModal = bootstrap.Modal.getInstance(modal);
    if (bsModal) bsModal.hide();
  }
}

// API Helper
async function apiCall(endpoint, method = 'GET', data = null) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (data) options.body = JSON.stringify(data);
  
  const response = await fetch(endpoint, options);
  return response.json();
}

// Initialize on page load
(function() {
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme) {
    document.documentElement.setAttribute('data-theme', savedTheme);
  }
})();
