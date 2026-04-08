# Amazon Linux 2023 相当の研修用シェル環境（vi / sudo 等の基本コマンドを含む）
FROM amazonlinux:2023

RUN dnf install -y \
    bash \
    findutils \
    gawk \
    grep \
    gzip \
    hostname \
    less \
    procps-ng \
    sed \
    shadow-utils \
    sudo \
    tar \
    util-linux \
    vim-minimal \
    which \
    && dnf clean all \
    && groupadd -g 1000 learner \
    && useradd -m -u 1000 -g 1000 -s /bin/bash learner \
    && mkdir -p /home/learner/exercise \
    && echo "practice file" > /home/learner/exercise/readme.txt \
    && chown -R learner:learner /home/learner

# 研修用: パスワード未設定でも sudo 演習できるよう NOPASSWD（コンテナ外への影響はホスト Docker で隔離）
RUN echo 'learner ALL=(ALL) NOPASSWD: ALL' > /etc/sudoers.d/learner-training \
    && chmod 440 /etc/sudoers.d/learner-training

COPY bashrc /home/learner/.bashrc
COPY profile /home/learner/.bash_profile
RUN chown learner:learner /home/learner/.bashrc /home/learner/.bash_profile

WORKDIR /home/learner
USER learner
