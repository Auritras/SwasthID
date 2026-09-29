 /* =========================================================
 7. REAL FOOD SEARCH, CALORIE LOGGING & PERSISTENCE
 ========================================================= */
 const FOOD_API_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search';
 const FOOD_API_KEY = 'DEMO_KEY';
 const foodSearchInput = document.getElementById('foodSearchInput');
 const foodSearchBtn = document.getElementById('foodSearchBtn');
 const foodSearchResults = document.getElementById('foodSearchResults');
 const foodSearchStatus = document.getElementById('foodSearchStatus');
 const nutritionEmptyState = document.getElementById('nutritionEmptyState');

 function getTodayKey(d = new Date()) { const x=new Date(d); return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`; }
 function getFoodLogs() {
   try { return JSON.parse(localStorage.getItem('swasth_foodLogs') || '[]'); }
   catch(e) { return []; }
 }
 function saveFoodLogs(logs) { localStorage.setItem('swasth_foodLogs', JSON.stringify(logs)); syncCloudState('swasth_foodLogs'); }
 function getTodayLogs() { return getFoodLogs().filter(x => x.date === getTodayKey()); }
 function nutrientValue(food, name, unitName = '') {
   const matches = (food.foodNutrients || []).filter(x => String(x.nutrientName || '').toLowerCase() === String(name).toLowerCase());
   if (!matches.length) return 0;
   const wantedUnit = String(unitName || '').toLowerCase();
   const match = wantedUnit
     ? (matches.find(x => String(x.unitName || '').toLowerCase() === wantedUnit) || matches[0])
     : matches[0];
   return match && Number.isFinite(Number(match.value)) ? Number(match.value) : 0;
 }
 function foodKcalPer100g(food) {
   const energies = (food.foodNutrients || []).filter(x => String(x.nutrientName || '').toLowerCase() === 'energy');
   const kcalEntry = energies.find(x => /^(kcal|cal)$/i.test(String(x.unitName || '').trim()));
   if (kcalEntry && Number.isFinite(Number(kcalEntry.value))) return Number(kcalEntry.value);
   const kjEntry = energies.find(x => /^kj$/i.test(String(x.unitName || '').trim()));
   if (kjEntry && Number.isFinite(Number(kjEntry.value))) return Number(kjEntry.value) / 4.184;
   const fallback = energies.find(x => Number.isFinite(Number(x.value)));
   return fallback ? Number(fallback.value) : 0;
 }
 function foodMacro(food, name) { return nutrientValue(food, name); }
 function escapeFoodText(v) {
   return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 }

 const INDIAN_FOOD_REFERENCE = [
  // Curated prototype subset aligned to IFCT 2017 food categories; values are normalized reference estimates per 100 g.
  ['Cooked white rice',130,2.4,28.2,0.3,[['1 katori',150],['1 cup',158],['2 cups',316]]],
  ['Cooked brown rice',123,2.7,25.6,1.0,[['1 katori',150],['1 cup',195],['2 cups',390]]],
  ['Roti (whole wheat)',297,11.0,58.0,3.7,[['1 small roti',30],['1 medium roti',40],['2 medium rotis',80]]],
  ['Chapati (whole wheat)',297,11.0,58.0,3.7,[['1 medium chapati',40],['2 chapatis',80],['3 chapatis',120]]],
  ['Plain paratha',320,7.5,44.0,12.0,[['1 small paratha',60],['1 medium paratha',80],['2 parathas',160]]],
  ['Aloo paratha',260,6.0,35.0,10.0,[['1 small aloo paratha',80],['1 medium aloo paratha',110],['2 aloo parathas',220]]],
  ['Naan',310,9.0,50.0,7.0,[['1 small naan',70],['1 medium naan',100],['2 naan',200]]],
  ['Puri',330,7.0,40.0,15.0,[['1 small puri',25],['2 puris',50],['4 puris',100]]],
  ['Poha',180,3.5,28.0,5.0,[['1 katori',150],['1 cup',180],['2 cups',360]]],
  ['Upma',150,4.0,24.0,4.0,[['1 katori',150],['1 cup',200],['2 cups',400]]],
  ['Idli',146,5.0,30.0,0.7,[['1 idli',50],['2 idlis',100],['3 idlis',150]]],
  ['Plain dosa',168,3.9,29.0,3.7,[['1 small dosa',60],['1 medium dosa',90],['2 dosas',180]]],
  ['Masala dosa',180,3.5,25.0,7.0,[['1 small masala dosa',120],['1 medium masala dosa',160],['2 dosas',320]]],
  ['Uttapam',170,4.5,28.0,4.0,[['1 small uttapam',80],['1 medium uttapam',120],['2 uttapams',240]]],
  ['Cooked moong dal',105,7.0,18.0,0.4,[['1 katori',150],['1 cup',200],['2 cups',400]]],
  ['Cooked masoor dal',116,7.5,20.0,0.4,[['1 katori',150],['1 cup',200],['2 cups',400]]],
  ['Cooked toor dal',115,7.0,20.0,0.5,[['1 katori',150],['1 cup',200],['2 cups',400]]],
  ['Dal tadka',125,6.0,15.0,4.5,[['1 katori',150],['1 cup',220],['2 cups',440]]],
  ['Rajma curry',140,7.5,20.0,3.5,[['1 katori',150],['1 cup',200],['2 cups',400]]],
  ['Chole (chickpea curry)',160,7.5,24.0,4.0,[['1 katori',150],['1 cup',200],['2 cups',400]]],
  ['Sambar',70,3.5,10.0,1.5,[['1 katori',150],['1 cup',240],['2 cups',480]]],
  ['Vegetable khichdi',125,4.0,20.0,2.5,[['1 katori',180],['1 cup',220],['2 cups',440]]],
  ['Curd (plain)',61,3.5,4.7,3.3,[['1 small bowl',100],['1 cup',245],['2 cups',490]]],
  ['Buttermilk',35,1.7,4.0,1.0,[['1 glass',250],['2 glasses',500],['1 litre',1000]]],
  ['Paneer',265,18.0,6.0,20.0,[['50 g',50],['100 g',100],['1 cup cubes',140]]],
  ['Paneer curry',190,10.0,8.0,13.0,[['1 katori',150],['1 cup',200],['2 cups',400]]],
  ['Milk (whole)',61,3.2,4.8,3.3,[['1 glass',200],['1 cup',244],['2 cups',488]]],
  ['Tea with milk and sugar',55,1.5,8.5,1.8,[['1 cup',150],['2 cups',300],['1 glass',200]]],
  ['Lassi (sweet)',95,3.0,15.0,2.5,[['1 glass',250],['2 glasses',500],['1 large glass',350]]],
  ['Aloo sabzi',110,2.0,16.0,4.0,[['1 katori',150],['1 cup',180],['2 cups',360]]],
  ['Bhindi sabzi',115,3.0,12.0,6.0,[['1 katori',120],['1 cup',150],['2 cups',300]]],
  ['Palak sabzi',75,3.0,7.0,3.5,[['1 katori',120],['1 cup',180],['2 cups',360]]],
  ['Mixed vegetable curry',105,3.0,12.0,4.5,[['1 katori',150],['1 cup',200],['2 cups',400]]],
  ['Cauliflower sabzi',90,3.0,10.0,4.0,[['1 katori',150],['1 cup',180],['2 cups',360]]],
  ['Cabbage sabzi',85,2.0,10.0,4.0,[['1 katori',150],['1 cup',180],['2 cups',360]]],
  ['Cucumber',16,0.7,3.6,0.1,[['1 small cucumber',100],['1 cup sliced',104],['2 cups',208]]],
  ['Tomato',20,0.9,3.9,0.2,[['1 medium tomato',123],['1 cup chopped',180],['2 cups',360]]],
  ['Carrot',41,0.9,9.6,0.2,[['1 medium carrot',61],['1 cup chopped',128],['2 cups',256]]],
  ['Banana',89,1.1,22.8,0.3,[['1 small banana',81],['1 medium banana',118],['1 large banana',136]]],
  ['Apple',52,0.3,13.8,0.2,[['1 small apple',149],['1 medium apple',182],['1 cup sliced',109]]],
  ['Orange',47,0.9,11.8,0.1,[['1 small orange',96],['1 medium orange',131],['1 cup sections',180]]],
  ['Mango',60,0.8,15.0,0.4,[['1 small mango',200],['1 cup sliced',165],['1 medium mango',300]]],
  ['Guava',68,2.6,14.3,1.0,[['1 small guava',100],['1 medium guava',150],['1 cup chopped',165]]],
  ['Papaya',43,0.5,10.8,0.3,[['1 cup cubes',145],['2 cups',290],['100 g',100]]],
  ['Pomegranate arils',83,1.7,18.7,1.2,[['1/2 cup',87],['1 cup',174],['100 g',100]]],
  ['Watermelon',30,0.6,7.6,0.2,[['1 cup diced',152],['2 cups',304],['1 wedge',280]]],
  ['Grapes',69,0.7,18.1,0.2,[['1/2 cup',76],['1 cup',151],['100 g',100]]],
  ['Coconut meat',354,3.3,15.2,33.5,[['2 tbsp',15],['1/2 cup grated',40],['100 g',100]]],
  ['Peanuts',567,25.8,16.1,49.2,[['1 tbsp',9],['1 small handful',30],['1/4 cup',36]]],
  ['Almonds',579,21.2,21.6,49.9,[['10 almonds',12],['1 small handful',28],['1/4 cup',36]]],
  ['Cashews',553,18.2,30.2,43.9,[['10 cashews',15],['1 small handful',28],['1/4 cup',32]]],
  ['Boiled egg',155,12.6,1.1,10.6,[['1 egg',50],['2 eggs',100],['3 eggs',150]]],
  ['Egg omelette',154,10.0,1.5,11.0,[['1 small omelette',80],['1 medium omelette',120],['2 omelettes',240]]],
  ['Chicken breast, cooked',165,31.0,0.0,3.6,[['100 g',100],['1 small piece',75],['1 large piece',150]]],
  ['Chicken curry',180,16.0,6.0,10.0,[['1 katori',150],['1 cup',200],['2 cups',400]]],
  ['Fish curry',140,14.0,5.0,7.0,[['1 katori',150],['1 cup',200],['2 cups',400]]],
  ['Rohu fish, cooked',160,20.0,0.0,8.0,[['1 small fillet',80],['1 medium fillet',120],['100 g',100]]],
  ['Chicken biryani',180,8.0,24.0,6.0,[['1 katori',180],['1 cup',205],['1 plate',300]]],
  ['Vegetable pulao',150,3.5,25.0,4.0,[['1 katori',180],['1 cup',200],['1 plate',300]]],
  ['Samosa',262,5.0,32.0,13.0,[['1 small samosa',60],['1 medium samosa',80],['2 samosas',160]]],
  ['Pakora',280,7.0,25.0,17.0,[['3 small pakoras',60],['1 serving',100],['2 servings',200]]],
  ['Dhokla',160,6.0,25.0,4.0,[['2 pieces',80],['1 plate',120],['2 plates',240]]],
  ['Pav bhaji',150,4.0,22.0,5.0,[['1 small plate',200],['1 plate',300],['2 plates',600]]],
  ['Vada pav',290,7.0,38.0,12.0,[['1 vada pav',120],['2 vada pav',240],['1 large',160]]],
  ['Idli sambar',110,4.5,19.0,2.0,[['2 idlis + sambar',220],['3 idlis + sambar',300],['1 plate',350]]],
  ['Dosa sambar',125,4.0,21.0,3.0,[['1 dosa + sambar',250],['1 large plate',350],['2 dosas + sambar',500]],
  ],
  ['Besan chilla',180,8.0,24.0,5.0,[['1 small chilla',60],['1 medium chilla',90],['2 chillas',180]]],
  ['Sprouted moong salad',90,7.0,14.0,1.0,[['1 small bowl',120],['1 cup',150],['2 cups',300]]],
  ['Roasted makhana',350,9.0,78.0,1.0,[['1 cup',15],['2 cups',30],['1 serving',25]]],
  ['Oats porridge',75,2.5,12.0,2.0,[['1 bowl',250],['1 cup',240],['2 cups',480]]],
  ['Ragi dosa',145,3.5,25.0,3.0,[['1 small dosa',70],['1 medium dosa',100],['2 dosas',200]]],
  ['Ragi roti',290,7.5,55.0,4.0,[['1 small roti',50],['1 medium roti',70],['2 rotis',140]]],
  ['Jowar roti',330,10.0,70.0,3.0,[['1 small roti',45],['1 medium roti',60],['2 rotis',120]]],
  ['Bajra roti',360,11.0,67.0,5.0,[['1 small roti',50],['1 medium roti',70],['2 rotis',140]]],
  ['Khakhra',450,12.0,65.0,15.0,[['1 khakhra',30],['2 khakhras',60],['3 khakhras',90]]],
  ['Murmura (puffed rice)',402,7.0,90.0,0.5,[['1 cup',14],['2 cups',28],['1 bowl',25]]],
  ['Sweet corn, boiled',96,3.4,21.0,1.5,[['1/2 cup',82],['1 cup',164],['1 cob',100]]],
  ['Boiled potato',87,1.9,20.1,0.1,[['1 small potato',100],['1 medium potato',150],['1 cup cubes',150]]],
  ['Sweet potato, boiled',76,1.4,17.7,0.1,[['1 small',100],['1 medium',150],['1 cup cubes',200]]],
  ['Lemon rice',175,3.0,30.0,5.0,[['1 katori',180],['1 cup',200],['1 plate',300]]],
  ['Curd rice',135,4.0,22.0,3.0,[['1 katori',200],['1 cup',220],['1 plate',300]]],
  ['Vegetable sambar rice',125,4.0,21.0,2.5,[['1 katori',200],['1 cup',220],['1 plate',320]]]
 ];

 function localFoodRecord(item){
   const [name,kcal,protein,carbs,fat,portions]=item;
   return {description:name,dataType:'IFCT 2017 reference',source:'IFCT 2017',foodNutrients:[
     {nutrientName:'Energy',value:kcal},{nutrientName:'Protein',value:protein},
     {nutrientName:'Carbohydrate, by difference',value:carbs},{nutrientName:'Total lipid (fat)',value:fat}
   ],commonPortions:portions};
 }
 const LOCAL_INDIAN_FOODS = INDIAN_FOOD_REFERENCE.map(localFoodRecord);
const LOCAL_FOOD_TOKEN_INDEX = new Map();
LOCAL_INDIAN_FOODS.forEach(food => {
  const tokens = String(food.description||'').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  tokens.forEach(token => {
    if (!LOCAL_FOOD_TOKEN_INDEX.has(token)) LOCAL_FOOD_TOKEN_INDEX.set(token, []);
    LOCAL_FOOD_TOKEN_INDEX.get(token).push(food);
  });
});
 function searchLocalIndianFoods(query){
   const q=String(query||'').toLowerCase().trim();
   if(!q) return [];
   const terms=q.split(/\s+/).filter(Boolean);
   const candidates=new Set();
   terms.forEach(term => {
     (LOCAL_FOOD_TOKEN_INDEX.get(term)||[]).forEach(food=>candidates.add(food));
     if(term.length >= 3) LOCAL_FOOD_TOKEN_INDEX.forEach((foods, token) => { if(token.startsWith(term)) foods.forEach(food=>candidates.add(food)); });
   });
   return [...candidates].map(food => {
     const name=food.description.toLowerCase();
     const score=terms.reduce((sum,t)=>sum+(name===t?8:name.startsWith(t)?5:name.includes(t)?2:0),0);
     return {food,score};
   }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,8).map(x=>x.food);
 }
 function getFoodPortions(food){
   if(Array.isArray(food?.commonPortions) && food.commonPortions.length) return food.commonPortions;
   const n=String(food?.description||'').toLowerCase();
   if(/banana/.test(n)) return [['1 small banana',81],['1 medium banana',118],['1 large banana',136]];
   if(/apple/.test(n)) return [['1 small apple',149],['1 medium apple',182],['1 cup sliced',109]];
   if(/orange/.test(n)) return [['1 small orange',96],['1 medium orange',131],['1 cup sections',180]];
   if(/roti|chapati/.test(n)) return [['1 small roti',30],['1 medium roti',40],['2 rotis',80]];
   if(/rice/.test(n)) return [['1/2 cup',79],['1 cup',158],['1.5 cups',237]];
   if(/dal|curry|sambar|sabzi|khichdi/.test(n)) return [['1/2 katori',75],['1 katori',150],['1 cup',200]];
   if(/idli/.test(n)) return [['1 idli',50],['2 idlis',100],['3 idlis',150]];
   if(/dosa/.test(n)) return [['1 small dosa',60],['1 medium dosa',90],['2 dosas',180]];
   return [['50 g',50],['100 g',100],['150 g',150],['200 g',200]];
 }
 function getUserFoodAllergies(){
   const pd=patientData||{};
   const vals=[];
   const add=v=>{if(Array.isArray(v)) v.forEach(add); else if(v!=null && String(v).trim()) vals.push(String(v).toLowerCase());};
   add(pd.allergies); add(pd.normalAllergies);
   return vals.join(' ');
 }
 const FOOD_ALLERGY_RULES=[
   {keys:/peanut|groundnut/,terms:/peanut|groundnut/,label:'peanut/groundnut'},
   {keys:/dairy|milk|lactose/,terms:/milk|curd|yogurt|paneer|cheese|buttermilk|lassi|dairy/,label:'dairy'},
   {keys:/almond/,terms:/almond/,label:'almond'}, {keys:/cashew/,terms:/cashew/,label:'cashew'},
   {keys:/soy|soya/,terms:/soy|soya|tofu/,label:'soy'}, {keys:/egg/,terms:/egg|omelette/,label:'egg'},
   {keys:/wheat|gluten/,terms:/wheat|roti|chapati|paratha|naan|puri|khakhra/,label:'wheat/gluten'},
   {keys:/fish/,terms:/fish|rohu|salmon|tuna/,label:'fish'}, {keys:/shellfish|prawn|shrimp/,terms:/prawn|shrimp|shellfish/,label:'shellfish'},
   {keys:/sesame|til/,terms:/sesame|til/,label:'sesame'}
 ];
 function foodAllergyFlags(foodName){
   const allergy=getUserFoodAllergies(); const name=String(foodName||'').toLowerCase();
   if(!allergy) return [];
   return FOOD_ALLERGY_RULES.filter(r=>r.keys.test(allergy)&&r.terms.test(name)).map(r=>r.label);
 }

 function renderRecentFoodQuickAdd(){
   const el=document.getElementById('recentFoodQuickAdd'); if(!el) return;
   const seen=new Set(), items=[];
   getFoodLogs().slice().reverse().forEach(log=>{ const key=String(log.name||'').toLowerCase(); if(key&&!seen.has(key)){seen.add(key);items.push(log);} });
   const recent=items.slice(0,8);
   if(!recent.length){el.innerHTML='';return;}
   el.innerHTML=`<div class="quick-add"><span class="t-meta">Add again</span>${recent.map((x,i)=>`<button type="button" class="chip recent-food-btn" data-index="${i}">${escapeFoodText(x.name)}</button>`).join('')}</div>`;
   el.querySelectorAll('.recent-food-btn').forEach(btn=>btn.addEventListener('click',()=>{
     const log=recent[Number(btn.dataset.index)]; if(!log)return;
     const logs=getFoodLogs(); logs.push({...log,id:Date.now()+Math.random(),date:getTodayKey(),time:new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}),});
     saveFoodLogs(logs); syncTodayCalories(); renderTodayFoodLogs(); if(typeof window.renderWeeklyNutritionTrends==='function') window.renderWeeklyNutritionTrends(); renderRecentFoodQuickAdd();
     showToast?.('', 'Meal logged', `${log.name} · ${log.portion} added again.`);
   }));
 }

 function foodAllergyDisclaimer(){
   return '<p class="t-meta">This only checks the food name, not its full ingredients. Check the packaging when an allergy matters.</p>';
 }
 function renderTodayFoodLogs() {
   const list = document.getElementById('recentMealsList');
   if (!list) return;
   const logs = getTodayLogs();
   if (!logs.length) {
     list.innerHTML = '';
     if (nutritionEmptyState) nutritionEmptyState.style.display = 'block';
     return;
   }
   if (nutritionEmptyState) nutritionEmptyState.style.display = 'none';
   const groups=['Breakfast','Lunch','Dinner','Snack','Unspecified'];
   const grouped=groups.map(type=>({type,items:logs.filter(x=>(x.mealType||'Unspecified')===type)})).filter(g=>g.items.length);
   list.innerHTML = grouped.map(group=>`<div class="meal-group"><h3 class="t-meta meal-group-title">${group.type === 'Unspecified' ? 'Other' : group.type}</h3><div class="list">${group.items.slice().reverse().map(log => {
     const flags=foodAllergyFlags(log.name);
     return `<div class="list-row meal-row"><div class="list-main"><b>${escapeFoodText(log.name)}</b><span>${escapeFoodText(log.portion)} · ${escapeFoodText(log.time)} · P ${Number(log.protein||0).toFixed(1)} g · C ${Number(log.carbs||0).toFixed(1)} g · F ${Number(log.fat||0).toFixed(1)} g</span>${flags.length?`<span class="badge badge-danger">Allergy: ${escapeFoodText(flags.join(', '))}</span>`:''}</div><span class="list-end">${Math.round(log.kcal)} kcal</span></div>`;
   }).join('')}</div></div>`).join('');
 }

 function syncTodayCalories() {
   const total = getTodayLogs().reduce((sum, x) => sum + Number(x.kcal || 0), 0);
   globalKcal = Math.round(total);
   localStorage.setItem('swasth_addedKcal', String(globalKcal));
   updateCalorieDisplays();
 }

 function addFoodLog(food, grams, mealType = 'Unspecified', portionLabel = '') {
   const kcal100 = foodKcalPer100g(food);
   if (!kcal100) {
     showToast('', 'Nutrition data unavailable', 'This food did not include a usable calorie value.');
     return;
   }
   const portion = Math.max(1, Number(grams) || 100);
   const factor = portion / 100;
   const log = {
     id: Date.now() + Math.random(),
     date: getTodayKey(),
     time: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}),
     name: food.description || 'Food',
     portion: portionLabel || `${Math.round(portion)} g`,
     mealType,
     kcal: kcal100 * factor,
     protein: foodMacro(food, 'Protein') * factor,
     carbs: foodMacro(food, 'Carbohydrate, by difference') * factor,
     fat: foodMacro(food, 'Total lipid (fat)') * factor,
     source: food.source || 'USDA FoodData Central'
   };
   const logs = getFoodLogs();
   logs.push(log);
   saveFoodLogs(logs);
   syncTodayCalories();
   renderTodayFoodLogs();
   renderRecordFoodLogs(); renderRecordTimeline();
   showToast('', 'Meal logged', `${log.name} · ${Math.round(log.kcal)} kcal added to today.`);
 }

 function renderFoodResults(foods) {
   if (!foodSearchResults) return;
   if (!foods.length) {
     foodSearchResults.innerHTML = '<div class="empty">No match. Try a simpler name, or scan the barcode if it’s packaged.</div>';
     return;
   }
   foodSearchResults.innerHTML = foods.slice(0,8).map((food, i) => {
     const kcal = foodKcalPer100g(food), protein = foodMacro(food, 'Protein'), carbs = foodMacro(food, 'Carbohydrate, by difference'), fat = foodMacro(food, 'Total lipid (fat)');
     const portions=getFoodPortions(food);
     const flags=foodAllergyFlags(food.description);
     return `<div class="food-result">
       <div class="food-result-head">
         <div class="list-main">
           <b>${escapeFoodText(food.description)}</b>
           <span>${Math.round(kcal)} kcal · P ${protein.toFixed(1)} g · C ${carbs.toFixed(1)} g · F ${fat.toFixed(1)} g per 100 g · ${escapeFoodText(food.dataType || 'Indian reference food')}</span>
           ${flags.length?`<span class="badge badge-danger">Allergy: ${escapeFoodText(flags.join(', '))}</span>${foodAllergyDisclaimer()}`:''}
         </div>
         <button class="btn btn-sm food-log-btn" type="button" data-index="${i}" aria-expanded="false">Add</button>
       </div>
       <div class="food-portion-row" data-index="${i}" style="display:none;">
         <div class="chip-row" role="group" aria-label="Portion">${portions.map((p,j)=>`<button type="button" class="chip food-portion-btn" data-index="${i}" data-grams="${p[1]}" data-label="${escapeFoodText(p[0])}">${escapeFoodText(p[0])}</button>`).join('')}</div>
         <div class="portion-controls">
           <label class="portion-grams"><input class="food-grams-input" data-index="${i}" type="number" min="1" max="1000" step="1" value="100" aria-label="Grams"><span>g</span></label>
           <input class="food-grams-range" data-index="${i}" type="range" min="10" max="1000" step="5" value="100" aria-label="Portion in grams">
           <span class="food-grams-label visually-hidden" data-index="${i}">100 g</span>
           <select class="food-meal-type" data-index="${i}" aria-label="Meal"><option>Breakfast</option><option>Lunch</option><option>Dinner</option><option>Snack</option></select>
           <button class="btn btn-primary btn-sm food-confirm-btn" type="button" data-index="${i}">Log meal</button>
         </div>
       </div>
     </div>`;
   }).join('');
   document.querySelectorAll('.food-log-btn').forEach(btn => btn.addEventListener('click', () => {
     const row = document.querySelector(`.food-portion-row[data-index="${btn.dataset.index}"]`); if(row){ const open=row.style.display==='none'; row.style.display=open?'grid':'none'; btn.setAttribute('aria-expanded',String(open)); btn.textContent=open?'Cancel':'Add'; }
   }));
   document.querySelectorAll('.food-portion-btn').forEach(btn => btn.addEventListener('click', () => {
     const row=document.querySelector(`.food-portion-row[data-index="${btn.dataset.index}"]`); const input=row?.querySelector('.food-grams-input'); if(input) input.value=btn.dataset.grams;
     if(row) row.dataset.portionLabel=btn.dataset.label;
     row?.querySelectorAll('.food-portion-btn').forEach(x=>x.setAttribute('aria-pressed','false')); btn.setAttribute('aria-pressed','true');
   }));
   document.querySelectorAll('.food-grams-range').forEach(range => range.addEventListener('input', () => {
     const row=document.querySelector(`.food-portion-row[data-index="${range.dataset.index}"]`);
     const input=row?.querySelector('.food-grams-input'); const label=row?.querySelector('.food-grams-label');
     if(input) input.value=range.value; if(label) label.textContent=`${Math.round(Number(range.value))} g`;
   }));
   document.querySelectorAll('.food-grams-input').forEach(input => input.addEventListener('input', () => {
     const row=document.querySelector(`.food-portion-row[data-index="${input.dataset.index}"]`);
     const range=row?.querySelector('.food-grams-range'); const label=row?.querySelector('.food-grams-label');
     const value=Math.max(1,Math.min(1000,Number(input.value)||1));
     if(range) range.value=Math.max(10,Math.min(1000,value)); if(label) label.textContent=`${Math.round(value)} g`;
   }));
   document.querySelectorAll('.food-confirm-btn').forEach(btn => btn.addEventListener('click', () => {
     const row=document.querySelector(`.food-portion-row[data-index="${btn.dataset.index}"]`); const input=row?.querySelector('.food-grams-input');
     const select=row?.querySelector('.food-meal-type'); const grams=input?.value||100; const label=row?.dataset.portionLabel||`${Math.round(Number(grams))} g`;
     addFoodLog(foods[Number(btn.dataset.index)], grams, select?.value||'Unspecified', label); renderRecentFoodQuickAdd();
   }));
 }
 async function searchFoods() {
   const q=(foodSearchInput?.value||'').trim();
   if(!q){if(foodSearchStatus)foodSearchStatus.textContent='Enter a food name to search.';return;}
   const local=searchLocalIndianFoods(q);
   if(local.length){
     renderFoodResults(local);
     if(foodSearchStatus) foodSearchStatus.textContent=`${local.length} result${local.length===1?'':'s'} from Indian food data (IFCT 2017).`;
     return;
   }
   if(foodSearchStatus) foodSearchStatus.textContent='Searching USDA FoodData Central…';
   if(foodSearchBtn){ foodSearchBtn.disabled=true; foodSearchBtn.classList.add('is-loading'); }
   if(foodSearchResults) foodSearchResults.innerHTML='<div class="list">'+(window.medSkeletonRows?window.medSkeletonRows(3):'')+'</div>';
   try{
     const url=`${FOOD_API_URL}?api_key=${encodeURIComponent(FOOD_API_KEY)}&query=${encodeURIComponent(q)}&pageSize=8&dataType=Foundation,SR%20Legacy,Branded`;
     const res=await fetch(url); if(!res.ok) throw new Error(`Food search failed (${res.status})`);
     const data=await res.json(); const foods=data.foods||[]; renderFoodResults(foods);
     if(foodSearchStatus) foodSearchStatus.textContent=foods.length?`${foods.length} result${foods.length===1?'':'s'} from USDA FoodData Central.`:'';
   }catch(err){
     if(foodSearchStatus) foodSearchStatus.textContent='';
     if(foodSearchResults) foodSearchResults.innerHTML='<div class="empty">USDA food search isn’t reachable right now. Indian foods and barcode lookup still work.</div>';
   }finally{if(foodSearchBtn){foodSearchBtn.disabled=false;foodSearchBtn.classList.remove('is-loading');}}
 }
 if(foodSearchBtn) foodSearchBtn.addEventListener('click', searchFoods);
 if(foodSearchInput) foodSearchInput.addEventListener('keydown', e => { if(e.key === 'Enter') searchFoods(); });

 function restoreNutritionState() {
   renderTodayFoodLogs();
   syncTodayCalories();
   renderRecentFoodQuickAdd();
 }

 function getWaterState(){
   const key=getTodayKey();
   const raw=safeJsonParse(localStorage.getItem('swasth_waterIntake'),null);
   // A new day resets intake but keeps the user's chosen target.
   return raw&&raw.date===key?raw:{date:key,ml:0,target:Number(raw?.target)||2000};
 }
 function saveWaterState(state){ localStorage.setItem('swasth_waterIntake',JSON.stringify(state)); syncCloudState('swasth_waterIntake'); window.renderTodayStats?.(); }
 function renderWaterIntake(){
   const state=getWaterState(); const pct=Math.min(100,Math.round((state.ml/state.target)*100));
   const v=document.getElementById('waterTodayValue'),t=document.getElementById('waterTargetValue'),p=document.getElementById('waterProgressValue');
   if(v)v.textContent=`${state.ml.toLocaleString()} ml`; if(t)t.textContent=`${state.target.toLocaleString()} ml`; if(p)p.textContent=`${pct}%`;
   const bar=document.getElementById('waterProgressBar'); if(bar) bar.style.width=`${pct}%`;
 }
 document.querySelectorAll('.water-add-btn').forEach(btn=>btn.addEventListener('click',()=>{const st=getWaterState();st.ml+=Number(btn.dataset.ml||0);saveWaterState(st);renderWaterIntake();}));
 document.getElementById('editWaterTargetBtn')?.addEventListener('click',()=>{
   const st=getWaterState();
   const value=window.prompt('Set your daily water target (500–5000 ml):', String(st.target||2000));
   if(value===null) return;
   const target=Number(value);
   if(!Number.isFinite(target)||target<500||target>5000){ showToast?.('', 'Invalid water target', 'Choose a daily reference target between 500 and 5,000 ml.'); return; }
   st.target=Math.round(target); saveWaterState(st); renderWaterIntake();
   showToast?.('', 'Water target updated', `Daily reference target set to ${st.target.toLocaleString()} ml.`);
 });
 document.getElementById('waterResetBtn')?.addEventListener('click',()=>{const st=getWaterState();st.ml=0;saveWaterState(st);renderWaterIntake();});
 renderWaterIntake();

 restoreNutritionState();
