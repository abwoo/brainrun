"""Independent SciPy FIR reference for the native integration recording pipeline."""
import json
import numpy as np
from scipy.signal import firwin
result={}
t=np.arange(2001)/1000
x=.5+.2*np.sin(2*np.pi*40*t)+.1*np.sin(2*np.pi*350*t)
for rate in [250,500]:
    h=firwin(129,.4*rate,window="hamming",fs=1000)
    y=np.convolve(x,h,mode="valid")[::1000//rate]
    result[str(rate)]=y.tolist()
print(json.dumps(result))
