 /* =========================================================
 6. AI SPEEDOMETER RISK GAUGE
 ========================================================= */
 /** @returns {number} bounded prototype risk score */
 function calculatePersonalizedRisk() {
   const height = Number.parseFloat(patientData.vitals?.height);
   const weight = Number.parseFloat(patientData.vitals?.weight);
   const bmi = height > 0 && weight > 0 ? weight / Math.pow(height / 100, 2) : null;
   const age = calculateAge(patientData.dob);
   let score = 8;
   if (age !== null) score += age >= 65 ? 18 : age >= 50 ? 12 : age >= 35 ? 6 : 0;
   if (bmi !== null) {
     if (bmi >= 30) score += 16; else if (bmi >= 25) score += 8; else if (bmi < 18.5) score += 4;
   }
   const conditions = Array.isArray(patientData.conditions) ? patientData.conditions.filter(c => String(c.status || 'Ongoing').toLowerCase() !== 'resolved') : [];
   score += Math.min(24, conditions.length * 6);
   const smoking = String(patientData.lifestyle?.smoking || '').toLowerCase();
   if (smoking.includes('yes') || smoking.includes('current')) score += 15;
   else if (smoking.includes('former')) score += 6;
   const activity = Number(localStorage.getItem('swasth_stepsToday') || 0);
   if (activity >= 7000) score -= 3;
   return Math.max(5, Math.min(95, Math.round(score)));
 }

 function calculateAge(dob) {
   if (!dob) return null;
   const d = new Date(dob); if (Number.isNaN(d.getTime())) return null;
   const now = new Date(); let age = now.getFullYear() - d.getFullYear();
   const m = now.getMonth() - d.getMonth();
   if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
   return age >= 0 && age <= 130 ? age : null;
 }

 function animateRiskMeter() {
   const needle = document.getElementById('riskNeedle');
   const text = document.getElementById('riskScoreText');
   const statusText = document.getElementById('riskStatusText');
   if (!needle || !text || !statusText) return;
   const finalRisk = calculatePersonalizedRisk();
   needle.style.transform = 'rotate(180deg)';
   setTimeout(() => { needle.style.transform = 'rotate(0deg)'; }, 500);
   setTimeout(() => {
     const angle = (finalRisk / 100) * 180;
     needle.style.transform = `rotate(${angle}deg)`;
     let counter = 0;
     const interval = setInterval(() => {
       counter += Math.max(1, Math.ceil(finalRisk / 25));
       if (counter >= finalRisk) {
         counter = finalRisk; clearInterval(interval);
         const label = finalRisk < 25 ? 'Lower indicator range' : finalRisk < 50 ? 'Moderate indicator range' : 'Higher indicator range';
         statusText.innerHTML = `<b>${label}</b><br>Based on the health information currently in your profile.`;
         statusText.style.color = finalRisk < 25 ? 'var(--ok)' : finalRisk < 50 ? 'var(--warn, #B7791F)' : 'var(--danger)';
       }
       text.textContent = `${counter}%`;
     }, 35);
   }, 900);
 }
