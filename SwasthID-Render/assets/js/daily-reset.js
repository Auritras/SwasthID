 /* =========================================================
 13. MIDNIGHT RESET ENGINE
 ========================================================= */
 function checkAndResetDailyData() {
 const now = new Date();
 const todayString = now.toDateString();
 const lastSavedDate = localStorage.getItem('swasth_lastActiveDate');
 
 if (lastSavedDate && lastSavedDate !== todayString) {
 globalKcal = 0;
 localStorage.removeItem('swasth_addedKcal');
 syncTodayCalories();
 renderTodayFoodLogs();
 const medState = safeJsonParse(localStorage.getItem('swasth_medStatus') || '{}', {});
 const preservedHistory = Array.isArray(medState.history) ? medState.history.slice(-500) : [];
 const nextMedState = { history: preservedHistory };
 localStorage.setItem('swasth_medStatus', JSON.stringify(nextMedState));
 localStorage.removeItem('swasth_dailyMood');
 // Preserve longitudinal medication history while clearing only today's dose flags.
 syncCloudState('swasth_medStatus');
 syncCloudState('swasth_dailyMood');
 
 const mealsList = document.getElementById('recentMealsList');
 if(mealsList) mealsList.innerHTML = '';
 
 updateCalorieDisplays();
 
 document.querySelectorAll('.med-item').forEach(el => {
 el.classList.remove('taken');
 const btn = el.querySelector('.med-action');
 if (btn) btn.innerHTML = "Mark taken";
 });

 document.querySelectorAll('.mood-emoji').forEach(b => b.classList.remove('active'));
 
 showToast('', 'New Day Reset', 'Your daily trackers have been reset.');
 }
 
 localStorage.setItem('swasth_lastActiveDate', todayString);
 }

 // Initial calls
 checkAndResetDailyData();
 setInterval(checkAndResetDailyData, 3600000); 

 /* =========================================================
 PREMIUM POLISH — hero greeting, ripple, scroll reveal, navbar blur
 (additive only; does not alter existing functionality above)
 ========================================================= */
 function initPremiumPolish() {
 const greetEl = document.getElementById('heroGreeting');
 if (greetEl) {
 const h = new Date().getHours();
 greetEl.textContent = h >= 5 && h < 12 ? 'Good morning' : (h >= 12 && h < 17 ? 'Good afternoon' : 'Good evening');
 }

 }
