# SwasthID Risk API

FastAPI service wrapping an independent Python implementation of the AHA PREVENT equations.

Render start command:
`uvicorn main:app --host 0.0.0.0 --port $PORT`

The frontend must collect the required PREVENT inputs before requesting a score. The integration is explicitly informational and should not be presented as a diagnosis. AHA says PREVENT is validated for adults 30–79 without known CVD and advises caution outside the U.S.
