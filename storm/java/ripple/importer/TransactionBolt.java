package ripple.importer;

import java.util.Map;

import org.apache.storm.task.ShellBolt;
import org.apache.storm.topology.IRichBolt;
import org.apache.storm.topology.OutputFieldsDeclarer;
import org.apache.storm.tuple.Fields;

public class TransactionBolt extends ShellBolt implements IRichBolt {

  public TransactionBolt() {
    super("node", "transactionBolt.js");
  }

  @Override
  public void declareOutputFields(OutputFieldsDeclarer declarer) {
    declarer.declareStream("HDFS_txStream",  new Fields("hdfs_tx"));
    declarer.declareStream("paymentsAggregation",  new Fields("payment", "key"));
    declarer.declareStream("exchangeAggregation", new Fields("exchange", "pair"));
    declarer.declareStream("statsAggregation",    new Fields("stat", "label"));
    declarer.declareStream("accountPaymentsAggregation", new Fields("payment", "account"));
  }

  @Override
  public Map<String, Object> getComponentConfiguration() {
    return null;
  }
}
