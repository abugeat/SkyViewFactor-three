from math import pi
from random import random
from re import U
from matplotlib.pyplot import axis
import plotly.express as px
import numpy as np
import math
import plotly.graph_objects as go

def perpvec(v): 
    
    if (abs(v[2])<abs(v[0])):
        newvec = np.array([v[1],-v[0],0.0])
    else:
        newvec = np.array([0.0,-v[2],v[1]])

    return newvec

def getQuaternion(ax, angle):
    half_angle = angle/2.0
    sin_half_angle = np.sin(half_angle)
    
    quat = np.array([0.0,0.0,0.0,0.0])
    quat[0] = ax[0] * sin_half_angle
    quat[1] = ax[1] * sin_half_angle
    quat[2] = ax[2] * sin_half_angle
    quat[3] = np.cos(half_angle)
    
    return quat

def rotateWithQuat(inivec, quat):
    print(inivec)
    print(quat)
    tempp = np.cross(quat[0:2], inivec) + quat[3] * inivec
    rotated = inivec + 2.0*np.cross(quat[0:2], tempp)

    return rotated
    
randAngCos = math.asin(random())
normal = np.array([0.0,0.0,-1.0])
arbitraryax = perpvec(normal)
quatOne = getQuaternion(arbitraryax, randAngCos)
newDirection = rotateWithQuat(normal, quatOne)
print(newDirection)






# # float random (vec2 st) {
# #     return fract(sin(dot(st.xy,
# #                          vec2(12.9898,78.233)))*
# #         43758.5453123);
# # }
# import numpy
# import math
# import time
# import statistics
# # import plotly
# import plotly.express as px

# def random(x, y):
#     return (math.sin(numpy.dot([x,x],[12.9898,78.233])))*43758.5453123 % 1

# def rand2():
#     return (math.sin(numpy.dot([time.time(),time.time()],[12.9898,78.233])))*43758.5453123 % 1

# def rand3(pos):
#     return (math.sin(numpy.dot([time.time(),pos],[12.9898,78.233])))*43758.5453123 % 1


# r = []
# quant = 100

# t = time.time()
# for i in range(quant):
#     # r.append(random(time.time(),time.time()))
#     r.append(rand3(i))
#     # time.sleep(0.01)

# print(time.time()-t)

# fig = px.scatter(x=range(quant), y=r)
# fig.show()

# print(statistics.mean(r))


# from math import pi
# from random import random
# from re import U
# from matplotlib.pyplot import axis
# import plotly.express as px
# import numpy as np
# import math
# import plotly.graph_objects as go

# quant = 10000
# r=[]
# for i in range(quant):
#     r.append(np.arccos(random())*180/pi)

# fig = px.scatter(x=range(quant), y=r)
# fig.show()
# print(np.mean(r))





# axs = np.array([0,1,0])

# u = np.array([0,0,1])

# angle = math.pi/5.0
# half_angle = angle/2

# q = np.array([
#     axs[0] * math.sin(half_angle),
#     axs[1] * math.sin(half_angle),
#     axs[2] * math.sin(half_angle),
#     math.cos(half_angle)
# ])

# temp = np.cross(q[:-1], u) + q[-1] * u
# rotated = u + 2.0 * np.cross(q[:-1], temp)

# print(q)

# fig = go.Figure(data=go.Cone(
#     x=[0,0,0], y=[0,0,0], z=[0,0,0], 
#     u=[u[0],axs[0],rotated[0]], v=[u[1],axs[1],rotated[1]], w=[u[2],axs[2],rotated[2]]))

# fig.update_layout(scene_camera_eye=dict(x=-0.76, y=1.8, z=0.92))

# fig.show()