FROM python:3.9.13-buster

RUN apt-get update && \
apt-get install -y ffmpeg && \
python -m pip install \
--upgrade pip \
--upgrade setuptools &&\
git clone https://github.com/Rapptz/discord.py &&\
cd discord.py &&\
python -m pip install -U .[voice] &&\
python -m pip install requests &&\
python -m pip install motor dnspython

