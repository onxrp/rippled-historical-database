

make sure ssh is started and available
sudo service ssh status


Java install:
https://www.linuxuprising.com/2021/09/how-to-install-oracle-java-17-lts-on.html
https://linuxize.com/post/install-java-on-ubuntu-18-04/#set-the-java_home-environment-variable


Hadoop install (java already installed):
https://computingforgeeks.com/how-to-install-apache-hadoop-hbase-on-ubuntu/

JAVA_HOME in hadoop-env.sh file: (line 54) Differs per environment
/usr/lib/jvm/java-8-openjdk-amd64/jre

HBase install:
download link changed: https://dlcdn.apache.org/hbase/$VER/hbase-$VER-bin.tar.gz

JAVA_HOME in hbase-env.sh file: (line 27) Differs per environment
/usr/lib/jvm/java-8-openjdk-amd64/jre


hbase rootdir should be on port 9000 since latest release
<property>
  <name>hbase.rootdir</name>
  <value>hdfs://localhost:9000/hbase</value>
</property>

HBASe lots of read fixes: http://gbif.blogspot.com/2012/07/optimizing-writes-in-hbase.html



Ports you can check in the browser:
<your ip>:9870/dfshealth.html#tab-overview
<your ip>:20550
<your ip>:8088/cluster
<your ip>:16010 (hbase)



sudo su - hadoop

$ start-all.sh
$ start-hbase.sh
$ hbase-daemon.sh start rest -p 20550
$ hbase-daemon.sh start thrift -f -p 9090


$ hbase-daemon.sh stop thrift
$ hbase-daemon.sh stop rest
$ stop-hbase.sh
$ stop-all.sh


/usr/local/HBase/logs/hbase-hadoop-rest-ip-172-31-16-252.us-east-2.compute.internal.out


How to fix corrupted files for an HBase table

Recovery instructions:
switch to hbase user: su hbase
hbase hbck -details to understand the scope of the problem
hbase hbck -fix to try to recover from region-level inconsistencies
hbase hbck -repair tried to auto-repair, but actually increased number of inconsistencies by 1
hbase hbck -fixMeta -fixAssignments
hbase hbck -repair this time tables got repaired
hbase hbck -details to confirm the fix
At this point, HBase was healthy, added additional region, and de-referenced corrupted files. However, HDFS still had corrupted files. Since they were no longer referenced by HBase, we deleted them:

switch to hdfs user: su hdfs
hdfs fsck / to understand the scope of the problem
hdfs fsck / -delete remove corrupted files only
hdfs fsck / to confirm healthy status
NOTE: it is important to fully stop the stack to reset caches (stop all services thrift, hbase, zoo keeper, hdfs and start them again in a reverse order).

Delete on hbase lock:
hdfs dfs -rm -R /hbase/.tmp/hbase-hbck.lock 


https://www.linkedin.com/pulse/solved-mystery-blockmissingexception-hadoop-file-system-rajat-kumar


WITH HBACK2

hbase hbck -j /usr/local/hbase-operator-tools/hbase-hbck2/target/hbase-hbck2-1.2.0.jar
for example
hbase hbck -j /usr/local/hbase-operator-tools/hbase-hbck2/target/hbase-hbck2-1.2.0.jar filesystem -fix


mkdir /hadoop/bak
cp /hadoop/zookeeper/myid /hadoop/bak/

hbase-daemon.sh stop thrift
hbase-daemon.sh stop rest
local-regionservers.sh stop 2 3 4 5
stop-hbase.sh
zkServer.sh stop
stop-yarn.sh
stop-dfs.sh

rm -Rf /hadoop/zookeeper/*
cp /hadoop/bak/myid  /hadoop/zookeeper/

start-dfs.sh
start-yarn.sh
zkServer.sh start
start-hbase.sh
local-regionservers.sh start 2 3 4 5
hbase-daemon.sh start rest -p 20550
hbase-daemon.sh start thrift -f -p 9090

jps (check runnign shizle)

pm2 start "storm nimbus" --name storm-nimbus
pm2 start "storm supervisor" --name storm-supervisor
pm2 start "storm ui" --name storm-ui


tail -1000 /usr/local/HBase/logs/hbase-ec2-user-master-ip-172-31-7-102.us-east-2.compute.internal.log
tail -1000 /usr/local/HBase/logs/hbase-ec2-user-regionserver-ip-172-31-7-102.us-east-2.compute.internal.log
tail -1000 /usr/local/HBase/logs/hbase-ec2-user-2-regionserver-ip-172-31-7-102.us-east-2.compute.internal.log
tail -1000 /usr/local/HBase/logs/hbase-ec2-user-zookeeper-ip-172-31-7-102.us-east-2.compute.internal.log
tail -1000 /usr/local/HBase/logs/hbase-ec2-user-rest-ip-172-31-7-102.us-east-2.compute.internal.log
tail -1000 /usr/local/HBase/logs/hbase-ec2-user-thrift-ip-172-31-7-102.us-east-2.compute.internal.log

tail -1000 /usr/local/zookeeper/logs/zookeeper-ec2-user-server-ip-172-31-7-102.us-east-2.compute.internal.out

tail -1000 /usr/local/ripple-historical-database/logs/backfill.log
tail -1000 /usr/local/ripple-historical-database/logs/default.log
tail -1000 /usr/local/ripple-historical-database/logs/live.log
tail -1000 /usr/local/ripple-historical-database/logs/hbase.log
tail -1000 /usr/local/ripple-historical-database/logs/api.log

/usr/local/ripple-historical-database/storm/production/importer.sh start
/usr/local/ripple-historical-database/storm/production/importer.sh restart
/usr/local/ripple-historical-database/storm/production/importer.sh stop

tail -1000 /usr/local/storm/logs/worker-6700.log

// check space
du -sh /usr/local/*
// usually here: /usr/local/ripple-historical-database
// usually here: /usr/local/HBase/logs


https://www.sentinelone.com/blog/ec2-memory-usage/
log-configuration-aws.json
sudo nano /opt/aws/amazon-cloudwatch-agent/bin/config.json
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -c file:/opt/aws/amazon-cloudwatch-agent/bin/config.json -s
systemctl restart amazon-cloudwatch-agent.service










// old shizzle
yarn run import:live
yarn run import:backfill -- --startIndex 70000000
yarn run import:createTables


node /usr/local/ripple-historical-database/scripts/import/backfill.js --startIndex 70000000
pm2 delete ripple-histdb-backfill 
pm2 start /usr/local/ripple-historical-database/scripts/import/backfill.js --name ripple-histdb-backfill --restart-delay 60000 -- --startIndex 70135272

yarn run import:backfill -- --startIndex

cd /usr/local/ripple-historical-database
pm2 start "yarn run import:backfill --startIndex 70135272" --name ripple-histdb-backfill
pm2 start "yarn run import:backfill --startIndex 71200000 --stopIndex 71258655" --name ripple-histdb-backfill-lastday
pm2 start "yarn run import:live" --name ripple-histdb-liveimport
pm2 start "yarn run start" --name ripple-histdb-api