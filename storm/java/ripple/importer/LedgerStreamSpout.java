package ripple.importer;

import org.apache.storm.Config;
import org.apache.storm.spout.ShellSpout;
import org.apache.storm.topology.IRichSpout;
import org.apache.storm.topology.OutputFieldsDeclarer;
import org.apache.storm.tuple.Fields;

import java.util.Map;

public class LedgerStreamSpout extends ShellSpout implements IRichSpout {

  public LedgerStreamSpout() {
    super("node", "ledgerStreamSpout.js");
  }

  @Override
  public void declareOutputFields(OutputFieldsDeclarer declarer) {
    declarer.declareStream("txStream", new Fields("tx"));
    declarer.declareStream("HDFS_ledgerStream", new Fields("ledger"));
    declarer.declareStream("statsAggregation", new Fields("stat", "label"));
    declarer.declareStream("feeSummaryStream", new Fields("feeSummary"));
  }

  @Override
  public Map<String, Object> getComponentConfiguration() {
    Config conf = new Config();
        return conf;
  }
}
