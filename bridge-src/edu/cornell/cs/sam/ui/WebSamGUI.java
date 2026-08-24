package edu.cornell.cs.sam.ui;

import edu.cornell.cs.sam.core.AssemblerException;
import edu.cornell.cs.sam.core.Processor;
import edu.cornell.cs.sam.core.Program;
import edu.cornell.cs.sam.core.SamAssembler;
import edu.cornell.cs.sam.core.Sys;

import java.awt.Frame;
import java.io.File;
import java.io.StringReader;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import javax.swing.JPanel;
import javax.swing.SwingUtilities;

/** Thin browser integration layer for the unmodified SaM 2.6.3 simulator. */
public final class WebSamGUI extends SamGUI {
    private final Sys webSys;

    public WebSamGUI() { this(new Sys()); }

    private WebSamGUI(Sys sys) {
        super(sys);
        this.webSys = sys;
    }

    /** Display the original SaM Swing UI and maximize it inside CheerpJ. */
    public void startWeb() {
        start();
        SwingUtilities.invokeLater(new Runnable() {
            @Override public void run() {
                setExtendedState(getExtendedState() | Frame.MAXIMIZED_BOTH);
                hideNativeButtonPanel();
                validate();
            }
        });
    }

    /** Assemble source text in memory and load it into the unmodified SaM GUI. */
    public void loadSource(String source, String filename) throws Exception {
        Program program = SamAssembler.assemble(new StringReader(source));
        loadProgram(program, displayName(filename));
    }

    /** Browser-friendly load result: OK or ERR<TAB>line<TAB>message. */
    public String loadSourceChecked(String source, String filename) {
        try {
            loadSource(source, filename);
            return "OK";
        } catch (AssemblerException ex) {
            return errorResult(ex.getLine(), ex.getMessage());
        } catch (Exception ex) {
            return errorResult(0, ex.getMessage() == null ? ex.toString() : ex.getMessage());
        }
    }

    /** Current program-counter value (the next instruction SaM will execute). */
    public int getProgramCounter() {
        Processor cpu = webSys.cpu();
        return cpu == null ? -1 : cpu.get(Processor.PC);
    }

    /** Load a path from CheerpJ's virtual filesystem using SaM's native loader. */
    public void loadPath(String path) { loadFile(new File(path)); }

    /** Browser toolbar convenience wrappers around SaM's existing controls. */
    public void resetWeb() throws Exception { invokePrivate("reset"); }
    public void stepWeb() throws Exception { invokePrivate("step"); }
    public void runWeb() throws Exception { invokePrivate("run"); }
    public void stopWeb() throws Exception { invokePrivate("stop"); }

    /** Hide the duplicate Swing Run/Step/etc. button strip; menus remain available. */
    private void hideNativeButtonPanel() {
        try {
            Field field = SamGUI.class.getDeclaredField("buttonPanel");
            field.setAccessible(true);
            JPanel panel = (JPanel) field.get(this);
            if (panel != null) panel.setVisible(false);
        } catch (Exception ignored) { }
    }

    private String displayName(String filename) {
        return (filename == null || filename.length() == 0) ? "current.sam" : filename;
    }

    private String errorResult(int line, String message) {
        String safe = message == null ? "Assembler error" : message;
        safe = safe.replace('\t', ' ').replace('\r', ' ').replace('\n', ' ');
        return "ERR\t" + line + "\t" + safe;
    }

    private void invokePrivate(String methodName) throws Exception {
        Method method = SamGUI.class.getDeclaredMethod(methodName);
        method.setAccessible(true);
        method.invoke(this);
    }
}
