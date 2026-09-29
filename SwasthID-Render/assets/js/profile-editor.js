(function () {
  function showProfileEditor() {
    try {
      if (typeof window.openProfileModal === 'function') {
        window.openProfileModal({force:true});
        return;
      }
      const modal = document.getElementById('profileModal');
      if (modal) { modal.classList.add('show'); modal.style.display = 'flex'; }
    } catch (err) {
      console.error('Could not open profile editor:', err);
      const modal = document.getElementById('profileModal');
      if (modal) { modal.classList.add('show'); modal.style.display = 'flex'; }
    }
  }

  window.__addMedicineRow = function (event) {
    if (event) { event.preventDefault(); event.stopPropagation(); }
    try {
      const rows = readMedicineRowsRaw();
      if (!rows.length) rows.push({name:'', dose:'', schedule:'', packSize:'', times:[], reason:''});
      rows.push({name:'', dose:'', schedule:'', packSize:'', times:[], reason:''});
      renderMedicineInputRows(rows);
      const last = document.querySelector('#medicineInputRows .medicine-input-row:last-child .medicine-name-input');
      if (last) { last.focus(); last.scrollIntoView({block:'nearest'}); }
    } catch (err) {
      console.error('Add medicine failed:', err);
      const wrap = document.getElementById('medicineInputRows');
      if (wrap) {
        const row = document.createElement('div');
        row.className = 'medicine-input-row';
        row.innerHTML = '<input type="text" class="medicine-name-input" placeholder="Medicine name"><input type="text" class="medicine-dose-input" placeholder="Dose (e.g. 2 tablets)"><input type="text" class="medicine-schedule-input" placeholder="Schedule (e.g. Twice daily)"><input type="text" class="medicine-pack-input" placeholder="Pack size" aria-label="Pack size (optional, e.g. 30 tablets)" title="Optional, e.g. 30 tablets"><button type="button" class="medicine-remove-btn" data-remove-medicine="0">×</button>';
        wrap.appendChild(row);
        row.querySelector('.medicine-name-input')?.focus();
      }
    }
    return false;
  };

  window.__saveProfileForm = async function (event) {
    if (event) { event.preventDefault(); event.stopPropagation(); }
    const button = document.getElementById('saveProfileBtn');
    if (button) { button.disabled = true; button.textContent = 'Saving…'; }
    try {
      await window.savePersonalizedProfile();
      return false;
    } catch (err) {
      console.error('Profile save failed:', err);
      alert('We could not save your profile right now. Please try again.');
      return false;
    } finally {
      if (button) { button.disabled = false; button.textContent = 'Save profile'; }
    }
  };

  function bindProfileControls() {
    const edit = document.getElementById('editProfileBtn');
    if (edit && edit.dataset.profileEditorBound !== '1') {
      edit.dataset.profileEditorBound = '1';
      edit.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        showProfileEditor();
      });
    }

    const cancel = document.getElementById('cancelProfileBtn');
    if (cancel && cancel.dataset.profileCancelBound !== '1') {
      cancel.dataset.profileCancelBound = '1';
      cancel.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        if (typeof window.closeProfileModal === 'function') window.closeProfileModal();
        else { const modal=document.getElementById('profileModal'); if(modal){modal.classList.remove('show');modal.style.display='none';} }
      });
    }

    const modal=document.getElementById('profileModal');
    if(modal && modal.dataset.profileBackdropBound !== '1'){
      modal.dataset.profileBackdropBound='1';
      modal.addEventListener('click',function(event){
        if(event.target===modal){
          if(typeof window.closeProfileModal==='function') window.closeProfileModal();
          else {modal.classList.remove('show');modal.style.display='none';}
        }
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindProfileControls, {once:true});
  else bindProfileControls();
  // The profile panel can be rendered/replaced after login, so retry binding once more.
  setTimeout(bindProfileControls, 100);
  setTimeout(bindProfileControls, 500);
})();
