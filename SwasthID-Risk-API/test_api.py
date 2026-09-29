"""Tests for the Risk API: `pip install -r requirements-dev.txt && pytest`."""
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)

BASE = {
    'age': 55, 'sex': 'F', 'sbp': 130, 'totalCholesterol': 200, 'hdlCholesterol': 50,
    'egfr': 90, 'bmi': 26, 'diabetes': False, 'currentSmoker': False,
    'bpTreatment': False, 'statin': False,
}


def risk(**changes):
    res = client.post('/prevent', json={**BASE, **changes})
    assert res.status_code == 200, res.text
    return res.json()


def test_health():
    assert client.get('/health').json() == {'ok': True, 'service': 'swasthid-risk-api'}


def test_returns_three_percentages():
    body = risk()
    for key in ('tenYearCvd', 'tenYearAscvd', 'tenYearHf'):
        assert 0 < body[key] < 100, key
    # Heart attack and stroke are a subset of all cardiovascular disease.
    assert body['tenYearAscvd'] <= body['tenYearCvd']
    assert 'not a diagnosis' in body['note']


def test_risk_rises_with_smoking_blood_pressure_and_age():
    base = risk()['tenYearCvd']
    assert risk(currentSmoker=True)['tenYearCvd'] > base
    assert risk(sbp=160)['tenYearCvd'] > base
    assert risk(age=70)['tenYearCvd'] > base


def test_accepts_male_and_female_spellings():
    assert risk(sex='male')['tenYearCvd'] == risk(sex='M')['tenYearCvd']
    assert risk(sex='female')['tenYearCvd'] == risk(sex='F')['tenYearCvd']


def test_rejects_invalid_input():
    assert client.post('/prevent', json={**BASE, 'sex': 'X'}).status_code == 400
    # PREVENT is for adults 30 to 79.
    assert client.post('/prevent', json={**BASE, 'age': 25}).status_code == 422
    assert client.post('/prevent', json={**BASE, 'sbp': 300}).status_code == 422
    missing = dict(BASE)
    del missing['hdlCholesterol']
    assert client.post('/prevent', json=missing).status_code == 422
