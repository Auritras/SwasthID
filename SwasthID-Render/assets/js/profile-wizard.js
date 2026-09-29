(function(){
  const $=(id)=>document.getElementById(id);
  const safe=(fn)=>{try{return fn()}catch(e){console.warn('SwasthID v8 hardening:',e);}};

  // Replace native alerts with the app's toast system. This keeps demo flows non-blocking.
  const nativeAlert=window.alert;
  window.alert=function(message){
    const text=String(message||'');
    if(typeof window.showToast==='function'){
      window.showToast('', 'SwasthID', text);
    } else { nativeAlert(text); }
  };

  // Restore inline calorie/water editors and remove prompt-based handlers by cloning buttons.
  function openTargetEditor(kind){
    const overlay=$('inlineTargetEditor'), input=$('inlineTargetInput'), title=$('inlineTargetTitle'), help=$('inlineTargetHelp'), label=$('inlineTargetLabel');
    if(!overlay||!input)return;
    const isWater=kind==='water';
    const current=isWater ? (Number(JSON.parse(localStorage.getItem('swasth_waterIntake')||'{}')?.target)||2000) : (typeof getDailyCalorieTarget==='function'?getDailyCalorieTarget():2200);
    title.textContent=isWater?'Adjust water target':'Adjust calorie target';
    help.textContent=isWater?'Choose a daily reference hydration target.':'Choose your daily calorie benchmark.';
    label.textContent=isWater?'Daily water target (ml)':'Daily calorie target (kcal)';
    input.min=isWater?'500':'800'; input.max=isWater?'5000':'6000'; input.step=isWater?'50':'50'; input.value=current;
    overlay.dataset.kind=kind; overlay.hidden=false; setTimeout(()=>input.focus(),20);
  }
  function closeTargetEditor(){const o=$('inlineTargetEditor');if(o)o.hidden=true;}
  function saveTargetEditor(){
    const o=$('inlineTargetEditor'), input=$('inlineTargetInput'); if(!o||!input)return;
    const kind=o.dataset.kind, value=Number(input.value);
    if(kind==='water'){
      if(!Number.isFinite(value)||value<500||value>5000){window.showToast?.('', 'Invalid water target','Choose a value between 500 and 5,000 ml.');return;}
      const today=typeof getTodayKey==='function'?getTodayKey():new Date().toISOString().slice(0,10);
      let st=safe(()=>JSON.parse(localStorage.getItem('swasth_waterIntake')||'{}'))||{};
      if(st.date!==today)st={date:today,ml:0};
      st.target=Math.round(value); if(!Array.isArray(st.logs))st.logs=[];
      localStorage.setItem('swasth_waterIntake',JSON.stringify(st)); window.syncCloudState?.('swasth_waterIntake'); window.renderWaterIntake?.(); window.renderTodayStats?.();
      window.showToast?.('', 'Water target updated',`Daily reference target set to ${Math.round(value).toLocaleString()} ml.`);
    }else{
      if(typeof window.setDailyCalorieTarget!=='function'){closeTargetEditor();return;}
      if(!window.setDailyCalorieTarget(value))return;
      window.showToast?.('', 'Daily target updated',`Nutrition benchmark set to ${Math.round(value).toLocaleString()} kcal/day.`);
    }
    closeTargetEditor();
  }
  function replaceTargetButton(id,kind){
    const old=$(id); if(!old||old.dataset.v8Bound)return;
    const clone=old.cloneNode(true); old.replaceWith(clone); clone.dataset.v8Bound='1'; clone.addEventListener('click',()=>openTargetEditor(kind));
  }
  replaceTargetButton('editCalorieTargetBtn','calorie'); replaceTargetButton('editWaterTargetBtn','water');
  $('inlineTargetCancel')?.addEventListener('click',closeTargetEditor); $('inlineTargetSave')?.addEventListener('click',saveTargetEditor);
  $('inlineTargetEditor')?.addEventListener('click',e=>{if(e.target.id==='inlineTargetEditor')closeTargetEditor();});

  // Google sign-in. Use the real lexical state variables, not window.* properties.
  $('googleSignInBtn')?.addEventListener('click', async () => {
    const btn = $('googleSignInBtn');
    if (btn) btn.disabled = true;
    try {
      if (!auth) await initFirebaseDataLayer();
      if (!auth) throw new Error('Firebase Authentication is not configured.');
      const provider = new firebase.auth.GoogleAuthProvider();
      const result = await auth.signInWithPopup(provider);
      firebaseUser = result.user;
      await firebaseUser.reload();
      if (!firebaseUser.emailVerified) throw new Error('Google account email could not be verified.');
      cloudSyncReady = await loadCloudState();
      localStorage.setItem('swasth_loggedIn', 'true');
      localStorage.setItem('swasth_abhaId', firebaseUser.email || '');
      profileOnboardingRequired = typeof isProfileActuallyComplete === 'function' ? !isProfileActuallyComplete() : false;
      performLoginSetup(firebaseUser.email || 'SwasthID User');
      renderPersonalizedUI();
      showToast('', 'Google sign-in successful', 'Your secure SwasthID session is ready.');
    } catch (e) {
      console.error(e);
      showToast('', 'Google sign-in failed', e.message || 'Please try again.');
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  // Profile wizard: move the existing fields into four logical steps without changing save semantics.
  function initProfileWizard(){
    const form=$('profileForm'), grid=form?.querySelector('.profile-form-grid'); if(!form||!grid||grid.dataset.wizardReady==='1')return;
    grid.dataset.wizardReady='1';
    const fields=[...grid.children].filter(el=>el.classList.contains('profile-field'));
    if(!fields.length)return;
    const groups=[
      fields.filter(el=>['profileFirstNameInput','profileDobInput','profileBloodInput','profileOccupationInput','profileHeightInput','profileWeightInput'].some(id=>el.querySelector('#'+id))),
      fields.filter(el=>['profileSmokingInput','profileAlcoholInput','profileConditionsInput','medicineInputRows','profileCalorieInput'].some(id=>el.querySelector('#'+id))),
      fields.filter(el=>el.querySelector('#allergyOptions')||el.querySelector('#normalAllergyOptions')),
      fields.filter(el=>el.querySelector('#profileEmergencyNameInput')||el.querySelector('#profileEmergencyPhoneInput')||el.querySelector('#profileInsuranceProviderInput')||el.querySelector('#profileInsurancePolicyInput'))
    ];
    const assigned=new Set(groups.flat()); const leftovers=fields.filter(f=>!assigned.has(f)); if(leftovers.length)groups[1].push(...leftovers);
    const steps=groups.map((items,i)=>{const step=document.createElement('div');step.className='profile-wizard-step';step.dataset.step=String(i);items.forEach(x=>step.appendChild(x));return step;});
    grid.replaceChildren(...steps);
    const progress=document.createElement('div');progress.className='profile-wizard-progress';progress.innerHTML='<span></span><span></span><span></span><span></span>';
    const label=document.createElement('div');label.className='profile-wizard-step-label';label.id='profileWizardStepLabel';
    const nav=document.createElement('div');nav.className='profile-wizard-nav';nav.innerHTML='<button type="button" class="btn" id="profileWizardBack">Back</button><div class="profile-wizard-nav-right"><button type="button" class="btn" id="profileWizardCancel">Cancel</button><button type="button" class="btn btn-primary" id="profileWizardNext">Next</button></div>';
    form.insertBefore(progress,grid); form.insertBefore(label,grid); form.appendChild(nav);
    const labels=['Personal details','Health & lifestyle','Allergies','Emergency & insurance'];
    let current=Math.max(0,Math.min(3,Number(localStorage.getItem('swasth_profileWizardStep')||0)));
    function saveDraft(){
      const draft={}; form.querySelectorAll('input,select,textarea').forEach(el=>{if(el.id)draft[el.id]=el.type==='checkbox'?el.checked:el.value;});
      localStorage.setItem('swasth_profileWizardDraft',JSON.stringify(draft));
      localStorage.setItem('swasth_profileWizardStep',String(current));
    }
    function restoreDraft(){const d=safe(()=>JSON.parse(localStorage.getItem('swasth_profileWizardDraft')||'{}'))||{};Object.entries(d).forEach(([id,val])=>{const el=$(id);if(!el)return;if(el.type==='checkbox')el.checked=!!val;else if(el.value===''||!window.patientData?.[id])el.value=val;});}
    function render(){steps.forEach((x,i)=>x.classList.toggle('profile-wizard-hidden',i!==current));progress.querySelectorAll('span').forEach((x,i)=>x.classList.toggle('active',i<=current));label.textContent=`Step ${current+1} of 4 · ${labels[current]}`;const back=$('profileWizardBack'),next=$('profileWizardNext');if(back)back.disabled=current===0;if(next)next.textContent=current===3?'Save profile':'Next';}
    $('profileWizardBack').onclick=()=>{saveDraft();current=Math.max(0,current-1);render();};
    $('profileWizardCancel').onclick=()=>$('cancelProfileBtn')?.click();
    $('profileWizardNext').onclick=async()=>{saveDraft();if(current<3){current++;render();return;} const save=$('saveProfileBtn'); if(save){save.click();} localStorage.removeItem('swasth_profileWizardStep'); localStorage.removeItem('swasth_profileWizardDraft');};
    form.addEventListener('input',saveDraft); form.addEventListener('change',saveDraft);
    restoreDraft(); render();
  }
  initProfileWizard();
  document.addEventListener('DOMContentLoaded',initProfileWizard,{once:true});

  // Make the dashboard name generic if patient data is not populated yet.
  const medInput=$('medSearch'); if(medInput && /thyroxine/i.test(medInput.value))medInput.value='';
})();
