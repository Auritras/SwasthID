from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
import pandas as pd
from prevent import compute_prevent10

app = FastAPI(title='SwasthID Risk API', version='1.0.0')

class RiskInput(BaseModel):
    age: int = Field(..., ge=30, le=79)
    sex: str
    sbp: float = Field(..., ge=90, le=200)
    totalCholesterol: float = Field(..., ge=130, le=320)
    hdlCholesterol: float = Field(..., ge=20, le=100)
    egfr: float = Field(..., ge=15, le=140)
    bmi: float = Field(..., ge=18.5, le=39.9)
    diabetes: bool = False
    currentSmoker: bool = False
    bpTreatment: bool = False
    statin: bool = False

@app.get('/health')
def health():
    return {'ok': True, 'service': 'swasthid-risk-api'}

@app.post('/prevent')
def prevent_risk(inp: RiskInput):
    sex = str(inp.sex).upper()
    if sex not in {'M','F','MALE','FEMALE'}:
        raise HTTPException(400, 'Sex must be M or F.')
    sex = 'M' if sex.startswith('M') else 'F'
    row = {
        'PAT_ID': 'swasthid', 'AGE': inp.age, 'SEX': sex,
        'TCHOL': inp.totalCholesterol, 'HDL': inp.hdlCholesterol,
        'SBP': inp.sbp, 'BMI': inp.bmi, 'EGFR': inp.egfr,
        'T2DM': int(inp.diabetes), 'RECENT_SMOKING': int(inp.currentSmoker),
        'SMOKING_CURR': int(inp.currentSmoker), 'UACR': float('nan'),
        'HBA1C': float('nan'), 'ZIP': None
    }
    df = pd.DataFrame([row])
    scored = compute_prevent10(df, bp_treat_default=int(inp.bpTreatment), statin_default=int(inp.statin), smoking_preference='SMOKING_CURR', sdi_series=None)
    def value(name):
        v = scored.iloc[0].get(name)
        return None if pd.isna(v) else float(v)
    return {
        'model': 'AHA PREVENT-compatible independent implementation',
        'tenYearCvd': value('PREVENT10_CVD_FULL_PCT'),
        'tenYearAscvd': value('PREVENT10_ASCVD_FULL_PCT'),
        'tenYearHf': value('PREVENT10_HF_FULL_PCT'),
        'note': 'Informational reference estimate only. PREVENT was developed and validated primarily in U.S. populations and AHA advises caution outside the U.S.; this is not a diagnosis or treatment recommendation.'
    }
